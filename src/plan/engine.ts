/**
 * 通用 Plan 的本地确定性引擎：校验、报价、新鲜度判断。
 * 纯函数、无文件 IO；金额全程 credit micros 整数，禁止浮点运算。
 */

import { createHash } from "node:crypto";
import type {
  Gap,
  ItemCost,
  ItemValidation,
  Plan,
  PlanCheckResult,
  PlanItem,
  QuoteProblem,
  QuoteSnapshot,
  ScopeValue,
} from "./model.js";
import type { CapabilityContract, ScopeField } from "./registry.js";
import { CREDIT_MICROS, REGISTRY_REVISION, buildRunCommand, findCapability } from "./registry.js";
import { newQuoteId } from "./store.js";

const DOMAIN_RE =
  /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const COUNTRY_RE = /^[a-z]{2,10}$/;
const CREDITS_RE = /^\d+(\.\d{1,6})?$/;
const QUOTE_TTL_MS = 15 * 60 * 1000;

const PARSE_CREDITS_ERROR = "must be a positive decimal with at most six fractional digits";

/** 把十进制 credit 字符串解析为 micros；禁止浮点乘法。 */
export function parseCreditsToMicros(value: string, label: string): number {
  const message = `${label} ${PARSE_CREDITS_ERROR}`;
  const trimmed = value.trim();
  if (!CREDITS_RE.test(trimmed)) {
    throw new Error(message);
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  const micros = Number(intPart) * CREDIT_MICROS + Number(fracPart.padEnd(6, "0"));
  if (!Number.isSafeInteger(micros) || micros <= 0) {
    throw new Error(message);
  }
  return micros;
}

/** 把 micros 格式化为去尾零的十进制字符串（12 / 0.13 / 7.5）。 */
export function formatCreditMicros(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const abs = Math.abs(micros);
  const intPart = Math.trunc(abs / CREDIT_MICROS);
  const fracPart = abs % CREDIT_MICROS;
  if (fracPart === 0) return `${sign}${intPart}`;
  const frac = String(fracPart).padStart(6, "0").replace(/0+$/, "");
  return `${sign}${intPart}.${frac}`;
}

export function validatePlan(plan: Plan): PlanCheckResult {
  const planErrors = collectPlanErrors(plan);
  const items = plan.items.map((item) => validateItem(item));

  let status: PlanCheckResult["status"] = "valid";
  if (planErrors.length > 0 || items.some((item) => item.status === "invalid")) {
    status = "invalid";
  } else if (items.some((item) => item.status === "gaps")) {
    status = "gaps";
  }

  return { status, planErrors, items };
}

export function quotePlan(
  plan: Plan,
  now?: Date
): { ok: true; quote: QuoteSnapshot } | { ok: false; problems: QuoteProblem[] } {
  const check = validatePlan(plan);
  const problems: QuoteProblem[] = [];

  if (check.planErrors.length > 0) {
    addProblem(problems, null, ...check.planErrors);
  }

  const validationById = new Map(check.items.map((item) => [item.itemId, item]));

  for (const item of plan.items) {
    const validation = validationById.get(item.itemId);
    if (!validation) continue;
    if (validation.errors.length > 0) {
      addProblem(problems, item.itemId, ...validation.errors);
    }
    if (item.kind !== "placeholder") {
      for (const gap of validation.gaps) {
        if (gap.reason === "missing_required" || gap.reason === "unverified_pricing") {
          addProblem(problems, item.itemId, `${gap.field}: ${gap.reason} — ${gap.hint}`);
        }
      }
    }
  }

  const itemCosts: ItemCost[] = [];
  for (const item of plan.items) {
    const validation = validationById.get(item.itemId);
    if (!validation) continue;
    const priced = priceItem(item, validation);
    if (priced.internalErrors.length > 0) {
      addProblem(problems, item.itemId, ...priced.internalErrors);
    }
    if (priced.cost) {
      const capBlock = exactCapBlock(item, priced.cost);
      if (capBlock) addProblem(problems, item.itemId, capBlock);
      // scope 完整的资源项附带执行交接命令；plan 本身仍不执行、不预留
      const resolved = findCapability(item.capability);
      priced.cost.runCommand =
        item.kind !== "placeholder" && resolved.contract && validation.status === "valid"
          ? buildRunCommand(resolved.contract, validation.normalizedScope)
          : null;
      itemCosts.push(priced.cost);
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const created = now ?? new Date();
  const estimateCreditMicros = itemCosts.reduce(
    (sum, item) => sum + (item.estimateCreditMicros ?? 0),
    0
  );
  const maxCreditMicros = itemCosts.reduce((sum, item) => sum + item.maxCreditMicros, 0);

  const warnings: string[] = [];
  for (const item of check.items) {
    for (const warning of item.warnings) {
      warnings.push(`${item.itemId}: ${warning}`);
    }
  }

  const budget = plan.budgetCreditMicros;
  let status: QuoteSnapshot["status"] = "ready";
  let withinBudget = true;
  let headroomCreditMicros: number | null = null;

  if (budget === undefined) {
    warnings.push("no budget set on this plan");
  } else {
    headroomCreditMicros = budget - maxCreditMicros;
    withinBudget = maxCreditMicros <= budget;
    if (!withinBudget) {
      if (plan.budgetPolicy === "hard") {
        status = "over_budget";
      } else {
        warnings.push(
          `plan max ${formatCreditMicros(maxCreditMicros)} exceeds advisory budget ${formatCreditMicros(budget)}`
        );
      }
    }
  }

  const quote: QuoteSnapshot = {
    quoteId: newQuoteId(),
    planId: plan.planId,
    planVersion: plan.version,
    authority: "local_preview",
    manifestHash: computeManifestHash(plan, check.items),
    status,
    items: itemCosts,
    totals: { estimateCreditMicros, maxCreditMicros },
    budgetCheck: {
      withinBudget,
      budgetCreditMicros: budget ?? null,
      headroomCreditMicros,
    },
    registryRevision: REGISTRY_REVISION,
    warnings,
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + QUOTE_TTL_MS).toISOString(),
  };

  return { ok: true, quote };
}

export function describeQuoteFreshness(
  plan: Plan,
  now?: Date
): "none" | "fresh" | "stale" | "expired" {
  if (!plan.quote) return "none";
  if (plan.version !== plan.quote.planVersion) return "stale";
  const at = now ?? new Date();
  if (at.getTime() >= new Date(plan.quote.expiresAt).getTime()) return "expired";
  return "fresh";
}

// ── 内部：plan / item 校验 ──

function collectPlanErrors(plan: Plan): string[] {
  const ids = new Set(plan.items.map((item) => item.itemId));
  const errors: string[] = [];

  for (const item of plan.items) {
    for (const dep of item.after ?? []) {
      if (!ids.has(dep)) {
        errors.push(`item ${item.itemId} after references unknown item ${dep}`);
      }
    }
  }

  const cycle = detectAfterCycle(plan.items, ids);
  if (cycle) {
    errors.push(`item after dependencies form a cycle: ${cycle}`);
  }
  return errors;
}

/** DFS 三色标记检测 after 依赖环；忽略指向不存在 item 的边。 */
function detectAfterCycle(items: PlanItem[], ids: Set<string>): string | undefined {
  const graph = new Map<string, string[]>();
  for (const item of items) {
    graph.set(
      item.itemId,
      (item.after ?? []).filter((dep) => ids.has(dep))
    );
  }

  const color = new Map<string, "white" | "gray" | "black">();
  for (const id of ids) color.set(id, "white");

  let found: string | undefined;

  function dfs(id: string, path: string[]): boolean {
    color.set(id, "gray");
    for (const next of graph.get(id) ?? []) {
      const nextColor = color.get(next);
      if (nextColor === "gray") {
        const start = path.indexOf(next);
        found = [...path.slice(start), next].join(" → ");
        return true;
      }
      if (nextColor === "white" && dfs(next, [...path, next])) return true;
    }
    color.set(id, "black");
    return false;
  }

  for (const id of ids) {
    if (color.get(id) === "white" && dfs(id, [id])) break;
  }
  return found;
}

function validateItem(item: PlanItem): ItemValidation {
  const errors: string[] = [];
  const gaps: Gap[] = [];
  const warnings: string[] = [];
  let compiledInputs: Record<string, number> = {};
  let normalizedScope: Record<string, ScopeValue> = {};

  const resolved = findCapability(item.capability);
  if (!resolved.contract) {
    errors.push(resolved.error ?? `unknown capability "${item.capability}"`);
    if (item.kind === "placeholder" && item.maxCreditMicros === undefined) {
      errors.push("placeholder requires --max-credits so the spend bound is explicit");
    }
    return finishItem(item.itemId, errors, gaps, warnings, compiledInputs, normalizedScope);
  }

  const contract = resolved.contract;

  if (item.kind === "placeholder") {
    if (item.maxCreditMicros === undefined) {
      errors.push("placeholder requires --max-credits so the spend bound is explicit");
    } else {
      gaps.push({
        field: "scope",
        reason: "needs_upstream_result",
        hint: "Materialize with: aisa plan item-replace <plan> <item> --scope key=value ...",
      });
    }
  } else {
    const scoped = validateResourceScope(item, contract);
    errors.push(...scoped.errors);
    gaps.push(...scoped.gaps);
    normalizedScope = scoped.normalizedScope;
    if (scoped.errors.length === 0 && scoped.gaps.length === 0 && contract.deriveInputs) {
      const derived = contract.deriveInputs(normalizedScope);
      errors.push(...derived.errors);
      compiledInputs = derived.inputs;
    }
  }

  if (contract.costModel.kind === "unknown" && item.kind === "resource") {
    warnings.push(
      `capability ${contract.capabilityId} pricing is unverified; the item cap is the only spend bound`
    );
    if (item.maxCreditMicros === undefined) {
      gaps.push({
        field: "max_credits",
        reason: "unverified_pricing",
        hint: "Set a spend cap: aisa plan add/item-replace ... --max-credits <n> — it is the only spend bound for unverified pricing.",
      });
    }
  }

  if (contract.verification.status !== "verified") {
    warnings.push(`capability ${contract.capabilityId} pricing is ${contract.verification.status}`);
  }

  return finishItem(item.itemId, errors, gaps, warnings, compiledInputs, normalizedScope);
}

function finishItem(
  itemId: string,
  errors: string[],
  gaps: Gap[],
  warnings: string[],
  compiledInputs: Record<string, number>,
  normalizedScope: Record<string, ScopeValue>
): ItemValidation {
  const status = errors.length > 0 ? "invalid" : gaps.length > 0 ? "gaps" : "valid";
  return { itemId, status, errors, gaps, warnings, compiledInputs, normalizedScope };
}

function validateResourceScope(
  item: PlanItem,
  contract: CapabilityContract
): {
  errors: string[];
  gaps: Gap[];
  normalizedScope: Record<string, ScopeValue>;
} {
  const errors: string[] = [];
  const gaps: Gap[] = [];
  const normalizedScope: Record<string, ScopeValue> = {};
  const raw = item.scope ?? {};
  const known = new Set(contract.scopeSchema.map((field) => field.name));

  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      errors.push(`scope.${key}: unknown field for capability ${contract.capabilityId}`);
    }
  }

  for (const field of contract.scopeSchema) {
    const provided = raw[field.name];
    const missing = provided === undefined || provided === null;
    if (missing) {
      if (field.default !== undefined) {
        normalizedScope[field.name] = field.default;
        continue;
      }
      if (field.required) {
        gaps.push({
          field: `scope.${field.name}`,
          reason: "missing_required",
          hint: `Provide it with --scope ${field.name}=...`,
        });
      }
      continue;
    }

    const parsed = parseScopeField(field, provided);
    if (parsed.ok) {
      normalizedScope[field.name] = parsed.value;
    } else {
      errors.push(`scope.${field.name}: ${parsed.error}`);
    }
  }

  return { errors, gaps, normalizedScope };
}

function parseScopeField(
  field: ScopeField,
  raw: ScopeValue
): { ok: true; value: ScopeValue } | { ok: false; error: string } {
  switch (field.type) {
    case "domain": {
      if (typeof raw !== "string" && typeof raw !== "number") {
        return { ok: false, error: "must be a hostname such as openai.com (without a URL path)" };
      }
      const domain = String(raw).trim().toLowerCase();
      if (!DOMAIN_RE.test(domain)) {
        return { ok: false, error: "must be a hostname such as openai.com (without a URL path)" };
      }
      return { ok: true, value: domain };
    }
    case "month": {
      const month = String(raw).trim();
      if (!MONTH_RE.test(month)) {
        return { ok: false, error: "must be YYYY-MM, for example 2026-07" };
      }
      return { ok: true, value: month };
    }
    case "enum": {
      const value = String(raw).trim();
      if (!field.values?.includes(value)) {
        return { ok: false, error: `must be one of ${field.values?.join(", ") ?? ""}` };
      }
      return { ok: true, value };
    }
    case "integer": {
      let n: number;
      if (typeof raw === "number") {
        if (!Number.isInteger(raw)) return { ok: false, error: integerRangeMessage(field) };
        n = raw;
      } else if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
        n = Number(raw.trim());
      } else {
        return { ok: false, error: integerRangeMessage(field) };
      }
      if (field.min !== undefined && n < field.min) return { ok: false, error: integerRangeMessage(field) };
      if (field.max !== undefined && n > field.max) return { ok: false, error: integerRangeMessage(field) };
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (typeof raw === "string") {
        const folded = raw.trim().toLowerCase();
        if (folded === "true") return { ok: true, value: true };
        if (folded === "false") return { ok: true, value: false };
      }
      return { ok: false, error: "must be true or false" };
    }
    case "string": {
      if (typeof raw !== "string" && typeof raw !== "number") {
        return { ok: false, error: "must be a non-empty string (max 256 characters)" };
      }
      const text = String(raw).trim();
      if (!text || text.length > 256) {
        return { ok: false, error: "must be a non-empty string (max 256 characters)" };
      }
      return { ok: true, value: text };
    }
    case "string_list":
      return parseStringList(field, raw);
    case "country": {
      if (typeof raw !== "string" && typeof raw !== "number") {
        return { ok: false, error: "must be a country code such as us, or world" };
      }
      let country = String(raw).trim().toLowerCase();
      if (country === "ww" || country === "global") country = "world";
      if (!COUNTRY_RE.test(country)) {
        return { ok: false, error: "must be a country code such as us, or world" };
      }
      return { ok: true, value: country };
    }
    default:
      return { ok: false, error: "unsupported field type" };
  }
}

function integerRangeMessage(field: ScopeField): string {
  if (field.min !== undefined && field.max !== undefined) {
    return `must be an integer between ${field.min} and ${field.max}`;
  }
  if (field.min !== undefined) return `must be an integer >= ${field.min}`;
  if (field.max !== undefined) return `must be an integer <= ${field.max}`;
  return "must be an integer";
}

function parseStringList(
  field: ScopeField,
  raw: ScopeValue
): { ok: true; value: string[] } | { ok: false; error: string } {
  let parts: string[];
  if (Array.isArray(raw)) {
    parts = raw.map((item) => String(item).trim());
  } else if (typeof raw === "string" || typeof raw === "number") {
    parts = String(raw).split(",").map((item) => item.trim());
  } else {
    return { ok: false, error: "must be a comma-separated list" };
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    unique.push(part);
  }
  if (unique.length === 0) return { ok: false, error: "must contain at least one item" };
  if (field.maxItems !== undefined && unique.length > field.maxItems) {
    return { ok: false, error: `must contain at most ${field.maxItems} items` };
  }
  if (field.itemPattern) {
    for (const item of unique) {
      if (!field.itemPattern.test(item)) {
        return { ok: false, error: `item "${item}" does not match the expected pattern` };
      }
    }
  }
  return { ok: true, value: unique };
}

// ── 内部：计价 ──

function priceItem(
  item: PlanItem,
  validation: ItemValidation
): { cost?: ItemCost; internalErrors: string[] } {
  const resolved = findCapability(item.capability);
  if (!resolved.contract) {
    return { internalErrors: [resolved.error ?? `unknown capability "${item.capability}"`] };
  }
  const contract = resolved.contract;
  const sourceUrl = contract.verification.sources[0] ?? null;
  const verifiedAt = contract.verification.verifiedAt ?? null;

  if (item.kind === "placeholder") {
    if (item.maxCreditMicros === undefined) {
      return { internalErrors: ["placeholder requires --max-credits so the spend bound is explicit"] };
    }
    return {
      internalErrors: [],
      cost: {
        itemId: item.itemId,
        capability: item.capability,
        costModelKind: "placeholder",
        estimateCreditMicros: null,
        maxCreditMicros: item.maxCreditMicros,
        basis: {
          display: "placeholder: capped by caller; not executable until scope is set",
          inputs: {},
          sourceUrl,
          verifiedAt,
        },
      },
    };
  }

  const model = contract.costModel;

  if (model.kind === "exact_formula") {
    let micros = model.baseCreditMicros;
    const missing: string[] = [];
    for (const key of model.productInputs) {
      const factor = validation.compiledInputs[key];
      if (factor === undefined || factor < 1) {
        missing.push(key);
        continue;
      }
      micros *= factor;
    }
    if (missing.length > 0) {
      return {
        internalErrors: [
          `internal pricing error: exact_formula inputs must be >= 1 (${missing.join(", ")})`,
        ],
      };
    }
    if (!Number.isSafeInteger(micros)) {
      return { internalErrors: ["internal pricing error: exact_formula overflow"] };
    }
    return {
      internalErrors: [],
      cost: {
        itemId: item.itemId,
        capability: item.capability,
        costModelKind: "exact_formula",
        estimateCreditMicros: micros,
        maxCreditMicros: micros,
        basis: {
          display: formatExactDisplay(model.baseCreditMicros, model.productInputs, validation.compiledInputs, micros),
          inputs: { ...validation.compiledInputs },
          sourceUrl,
          verifiedAt,
        },
      },
    };
  }

  if (model.kind === "fixed") {
    return {
      internalErrors: [],
      cost: {
        itemId: item.itemId,
        capability: item.capability,
        costModelKind: "fixed",
        estimateCreditMicros: model.creditMicros,
        maxCreditMicros: model.creditMicros,
        basis: {
          display: model.display,
          inputs: {},
          sourceUrl,
          verifiedAt,
        },
      },
    };
  }

  if (model.kind === "bounded_response") {
    const rawMax = model.rateCreditMicros * model.cap;
    const itemCap = item.maxCreditMicros;
    const max = itemCap !== undefined ? Math.min(rawMax, itemCap) : rawMax;
    const cappedByItem = itemCap !== undefined && itemCap < rawMax;
    const rate = formatCreditMicros(model.rateCreditMicros);
    const rawDisplay = `${rate} credits per ${model.capUnit}, provider caps at ${model.cap} ${model.capUnit}s (max ${formatCreditMicros(rawMax)})`;
    const display = cappedByItem
      ? `${rawDisplay}; item cap lowers max to ${formatCreditMicros(max)}`
      : rawDisplay;
    const inputs: Record<string, number | string> = {
      rate,
      row_cap: model.cap,
    };
    if (cappedByItem && itemCap !== undefined) {
      inputs.item_cap = formatCreditMicros(itemCap);
    }
    return {
      internalErrors: [],
      cost: {
        itemId: item.itemId,
        capability: item.capability,
        costModelKind: "bounded_response",
        estimateCreditMicros: max,
        maxCreditMicros: max,
        basis: { display, inputs, sourceUrl, verifiedAt },
      },
    };
  }

  // unknown：调用方 cap 是唯一上界
  if (item.maxCreditMicros === undefined) {
    return { internalErrors: ["unverified pricing requires --max-credits"] };
  }
  return {
    internalErrors: [],
    cost: {
      itemId: item.itemId,
      capability: item.capability,
      costModelKind: "unknown",
      estimateCreditMicros: null,
      maxCreditMicros: item.maxCreditMicros,
      basis: {
        display: "caller cap only — pricing unverified",
        inputs: {},
        sourceUrl,
        verifiedAt,
      },
    },
  };
}

function formatExactDisplay(
  baseCreditMicros: number,
  productInputs: string[],
  inputs: Record<string, number>,
  totalMicros: number
): string {
  const parts = [`${formatCreditMicros(baseCreditMicros)} credit`];
  for (const key of productInputs) {
    const n = inputs[key];
    parts.push(`${n} ${labelProductInput(key, n)}`);
  }
  return `${parts.join(" x ")} = ${formatCreditMicros(totalMicros)}`;
}

function labelProductInput(key: string, n: number): string {
  switch (key) {
    case "metrics_count":
      return n === 1 ? "metric" : "metrics";
    case "countries_count":
      return n === 1 ? "country" : "countries";
    case "time_buckets":
      return n === 1 ? "monthly bucket" : "monthly buckets";
    default:
      return key.replace(/_/g, " ");
  }
}

function exactCapBlock(item: PlanItem, cost: ItemCost): string | undefined {
  if (cost.costModelKind !== "exact_formula" && cost.costModelKind !== "fixed") return undefined;
  if (item.maxCreditMicros === undefined) return undefined;
  if (item.maxCreditMicros >= cost.maxCreditMicros) return undefined;
  return `item cap ${formatCreditMicros(item.maxCreditMicros)} is below the exact price ${formatCreditMicros(cost.maxCreditMicros)}; raise the cap or reduce scope`;
}

function addProblem(problems: QuoteProblem[], itemId: string | null, ...messages: string[]): void {
  const existing = problems.find((problem) => problem.itemId === itemId);
  if (existing) {
    existing.problems.push(...messages);
    return;
  }
  problems.push({ itemId, problems: [...messages] });
}

/**
 * 本地版把整个 normalizedScope 纳入哈希。
 * 服务端版将按 cost_relevant 白名单放宽（非计价字段变更不再使 quote 失效）。
 */
function computeManifestHash(plan: Plan, validations: ItemValidation[]): string {
  const byId = new Map(validations.map((item) => [item.itemId, item]));
  const items = [...plan.items]
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0))
    .map((item) => {
      const validation = byId.get(item.itemId);
      const normalizedScope =
        item.kind === "placeholder" ? (item.scope ?? {}) : (validation?.normalizedScope ?? {});
      return {
        itemId: item.itemId,
        kind: item.kind,
        capability: item.capability,
        normalizedScope,
        compiledInputs: validation?.compiledInputs ?? {},
        maxCreditMicros: item.maxCreditMicros ?? null,
      };
    });

  const payload = {
    planId: plan.planId,
    planVersion: plan.version,
    budgetCreditMicros: plan.budgetCreditMicros ?? null,
    budgetPolicy: plan.budgetPolicy,
    registryRevision: REGISTRY_REVISION,
    items,
  };

  const digest = createHash("sha256").update(canonicalJson(payload)).digest("hex");
  return `sha256:${digest}`;
}

/** 对象键递归排序、数组保序的 canonical JSON，供 manifest hash 使用。 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}
