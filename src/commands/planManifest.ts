/**
 * 通用 Plan 命令层：创建/增删改查/校验/报价。
 * 业务金额走引擎的 micros 整数；面向用户的输出用十进制字符串。
 */

import chalk from "chalk";
import type {
  ItemCost,
  ItemValidation,
  Plan,
  PlanCheckResult,
  PlanItem,
  QuoteProblem,
  QuoteSnapshot,
} from "../plan/model.js";
import { capabilityRef, findCapability, searchCapabilities } from "../plan/registry.js";
import {
  describeQuoteFreshness,
  formatCreditMicros,
  parseCreditsToMicros,
  quotePlan,
  validatePlan,
} from "../plan/engine.js";
import {
  deletePlan,
  loadPlan,
  listPlans,
  newPlanId,
  nextItemId,
  savePlan,
} from "../plan/store.js";
import { formatJson, hint, success, table } from "../utils/display.js";

interface JsonOptions {
  json?: boolean;
}

function touch(plan: Plan): void {
  plan.version += 1;
  plan.updatedAt = new Date().toISOString();
}

function parseScopePairs(pairs?: string[] | string): Record<string, string> {
  const list = pairs === undefined ? [] : Array.isArray(pairs) ? pairs : [pairs];
  const scope: Record<string, string> = {};
  for (const pair of list) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new Error(`invalid --scope "${pair}" — expected key=value`);
    }
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (!key) throw new Error(`invalid --scope "${pair}" — expected key=value`);
    scope[key] = value;
  }
  return scope;
}

function parseAfter(after?: string): string[] | undefined {
  if (!after) return undefined;
  const ids = after.split(",").map((id) => id.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function assertBudgetPolicy(value: string): "hard" | "advisory" {
  if (value === "hard" || value === "advisory") return value;
  throw new Error(`--budget-policy must be hard or advisory`);
}

function assertOnDepFailure(value: string): "skip" | "proceed" {
  if (value === "skip" || value === "proceed") return value;
  throw new Error(`--on-dep-failure must be skip or proceed`);
}

function printJson(data: unknown): void {
  console.log(formatJson(data));
}

function creditsOrDash(micros: number | null | undefined): string {
  return micros === null || micros === undefined ? "—" : formatCreditMicros(micros);
}

function freshnessLabel(plan: Plan): string {
  const freshness = describeQuoteFreshness(plan);
  if (freshness === "none") return "—";
  return freshness;
}

// ── 线格式转换（内部 camelCase / micros → API snake_case / 十进制字符串）──

function wireCredits(micros: number | null | undefined): string | null {
  if (micros === null || micros === undefined) return null;
  return formatCreditMicros(micros);
}

function wireItem(item: PlanItem): Record<string, unknown> {
  return {
    item_id: item.itemId,
    kind: item.kind,
    capability: item.capability,
    scope: item.scope ?? null,
    phase: item.phase ?? null,
    after: item.after ?? null,
    on_dep_failure: item.onDepFailure ?? null,
    max_credits: wireCredits(item.maxCreditMicros),
    note: item.note ?? null,
  };
}

function wireItemCost(item: ItemCost): Record<string, unknown> {
  return {
    item_id: item.itemId,
    capability: item.capability,
    cost_model_kind: item.costModelKind,
    estimate_credits: wireCredits(item.estimateCreditMicros),
    max_credits: formatCreditMicros(item.maxCreditMicros),
    basis: item.basis,
  };
}

function wireQuote(quote: QuoteSnapshot, nextActions?: string[]): Record<string, unknown> {
  return {
    quote_id: quote.quoteId,
    plan_id: quote.planId,
    plan_version: quote.planVersion,
    authority: quote.authority,
    manifest_hash: quote.manifestHash,
    status: quote.status,
    items: quote.items.map(wireItemCost),
    totals: {
      estimate_credits: formatCreditMicros(quote.totals.estimateCreditMicros),
      max_credits: formatCreditMicros(quote.totals.maxCreditMicros),
    },
    budget_check: {
      within_budget: quote.budgetCheck.withinBudget,
      budget_credits: wireCredits(quote.budgetCheck.budgetCreditMicros),
      headroom_credits: wireCredits(quote.budgetCheck.headroomCreditMicros),
    },
    registry_revision: quote.registryRevision,
    warnings: quote.warnings,
    created_at: quote.createdAt,
    expires_at: quote.expiresAt,
    ...(nextActions ? { next_actions: nextActions } : {}),
  };
}

function wireGap(gap: ItemValidation["gaps"][number]): Record<string, unknown> {
  return { field: gap.field, reason: gap.reason, hint: gap.hint };
}

function wireItemValidation(item: ItemValidation): Record<string, unknown> {
  return {
    item_id: item.itemId,
    status: item.status,
    errors: item.errors,
    gaps: item.gaps.map(wireGap),
    warnings: item.warnings,
    compiled_inputs: item.compiledInputs,
    normalized_scope: item.normalizedScope,
  };
}

function wireCheck(result: PlanCheckResult): Record<string, unknown> {
  return {
    status: result.status,
    plan_errors: result.planErrors,
    items: result.items.map(wireItemValidation),
  };
}

function wirePlan(plan: Plan): Record<string, unknown> {
  return {
    schema: plan.schema,
    plan_id: plan.planId,
    version: plan.version,
    status: plan.status,
    intent: plan.intent ?? null,
    budget_credits: wireCredits(plan.budgetCreditMicros),
    budget_policy: plan.budgetPolicy,
    items: plan.items.map(wireItem),
    quote: plan.quote ? wireQuote(plan.quote) : null,
    next_item_seq: plan.nextItemSeq,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    quote_freshness: describeQuoteFreshness(plan),
  };
}

function wireProblems(problems: QuoteProblem[]): Record<string, unknown> {
  return {
    ok: false,
    problems: problems.map((problem) => ({
      item_id: problem.itemId,
      problems: problem.problems,
    })),
  };
}

function quoteNextActions(plan: Plan, quote: QuoteSnapshot): string[] {
  const actions: string[] = [];
  if (quote.status === "over_budget") {
    let largest = quote.items[0];
    for (const item of quote.items) {
      if (!largest || item.maxCreditMicros > largest.maxCreditMicros) largest = item;
    }
    if (largest) {
      actions.push(
        `Largest spend bound is ${largest.itemId} (${formatCreditMicros(largest.maxCreditMicros)} credits max). Reduce its scope or cap, or raise the budget: aisa plan set-budget ${plan.planId} <credits>`
      );
    }
  }
  for (const item of plan.items) {
    if (item.kind === "placeholder") {
      actions.push(
        `Materialize placeholder ${item.itemId} with: aisa plan item-replace ${plan.planId} ${item.itemId} --scope key=value ...`
      );
    }
  }
  actions.push(
    "This is a local preview quote — not a server reservation; do not treat it as a spend lock."
  );
  return actions;
}

function printItemValidation(item: PlanItem, validation: ItemValidation): void {
  console.log(`  ${item.itemId}  ${item.kind}  ${item.capability}  ${validation.status.toUpperCase()}`);
  for (const err of validation.errors) {
    console.log(`    error: ${err}`);
  }
  for (const gap of validation.gaps) {
    console.log(`    gap:   ${gap.field} (${gap.reason})`);
    hint(gap.hint);
  }
  for (const warning of validation.warnings) {
    console.log(`    warn:  ${warning}`);
  }
}

function itemValidationHints(validation: ItemValidation): void {
  if (validation.errors.length > 0) {
    hint("Fix the errors above, then re-run: aisa plan check <plan>");
  } else if (validation.gaps.some((gap) => gap.reason === "needs_upstream_result")) {
    hint("Set a concrete scope with: aisa plan item-replace <plan> <item> --scope key=value ...");
  } else if (validation.gaps.length > 0) {
    hint("Fill the gaps above, then re-run: aisa plan check <plan>");
  }
}

// ── actions ──

export async function planCreateAction(options: {
  budgetCredits?: string;
  budgetPolicy?: string;
  intent?: string;
  json?: boolean;
} = {}): Promise<void> {
  const policy = assertBudgetPolicy(options.budgetPolicy ?? "hard");
  const now = new Date().toISOString();
  const plan: Plan = {
    schema: 1,
    planId: newPlanId(),
    version: 1,
    status: "draft",
    intent: options.intent,
    budgetCreditMicros: options.budgetCredits
      ? parseCreditsToMicros(options.budgetCredits, "--budget-credits")
      : undefined,
    budgetPolicy: policy,
    items: [],
    nextItemSeq: 1,
    createdAt: now,
    updatedAt: now,
  };
  savePlan(plan);

  if (options.json) {
    printJson(wirePlan(plan));
    return;
  }

  console.log(`\n  ${chalk.cyan.bold("Plan created")}`);
  console.log(`  ${plan.planId}`);
  if (plan.intent) console.log(`  Intent:  ${plan.intent}`);
  console.log(
    `  Budget:  ${plan.budgetCreditMicros !== undefined ? formatCreditMicros(plan.budgetCreditMicros) : "—"} (${plan.budgetPolicy})`
  );
  hint(`Discover capabilities: aisa plan discover <query>`);
  hint(`Add an item: aisa plan add ${plan.planId} <capability> --scope key=value ...`);
}

export async function planListAction(options: JsonOptions = {}): Promise<void> {
  const plans = listPlans();
  if (options.json) {
    printJson(plans.map(wirePlan));
    return;
  }

  console.log(`\n  ${chalk.cyan.bold("Plans")}`);
  if (plans.length === 0) {
    hint("No plans yet. Create one: aisa plan create --budget-credits <n>");
    return;
  }

  console.log(
    table(
      ["PLAN", "ITEMS", "BUDGET", "QUOTE", "UPDATED"],
      plans.map((plan) => [
        plan.planId,
        String(plan.items.length),
        creditsOrDash(plan.budgetCreditMicros),
        freshnessLabel(plan),
        plan.updatedAt.replace("T", " ").replace(/\.\d+Z$/, "Z"),
      ])
    )
  );
}

export async function planShowAction(planId: string, options: JsonOptions = {}): Promise<void> {
  const plan = loadPlan(planId);
  if (options.json) {
    printJson(wirePlan(plan));
    return;
  }

  const freshness = describeQuoteFreshness(plan);
  console.log(`\n  ${chalk.cyan.bold("Plan")}  ${plan.planId}`);
  console.log(`  Version: ${plan.version}  Status: ${plan.status}`);
  if (plan.intent) console.log(`  Intent:  ${plan.intent}`);
  console.log(
    `  Budget:  ${creditsOrDash(plan.budgetCreditMicros)}  policy=${plan.budgetPolicy}`
  );
  console.log(`  Updated: ${plan.updatedAt}`);

  console.log(`\n  Items`);
  if (plan.items.length === 0) {
    hint("No items. Add one: aisa plan add <plan> <capability> --scope key=value ...");
  } else {
    for (const item of plan.items) {
      const bits = [
        item.itemId,
        item.kind,
        item.capability,
        item.phase ? `phase=${item.phase}` : undefined,
        item.after?.length ? `after=${item.after.join(",")}` : undefined,
        `cap=${creditsOrDash(item.maxCreditMicros)}`,
      ].filter(Boolean);
      console.log(`  ${bits.join("  ")}`);
      if (item.note) console.log(`    note: ${item.note}`);
    }
  }

  console.log(`\n  Quote`);
  if (!plan.quote || freshness === "none") {
    hint("No quote yet. Price this plan: aisa plan quote " + plan.planId);
  } else {
    const quote = plan.quote;
    console.log(
      `  ${quote.quoteId}  ${quote.status}  freshness=${freshness}  authority=${quote.authority}`
    );
    console.log(
      `  Estimate ${formatCreditMicros(quote.totals.estimateCreditMicros)}  Max ${formatCreditMicros(quote.totals.maxCreditMicros)}`
    );
    console.log(`  Manifest ${quote.manifestHash}`);
    console.log(`  Expires  ${quote.expiresAt}`);
    if (freshness === "stale" || freshness === "expired") {
      console.log(chalk.yellow(`  Quote is ${freshness} — re-quote: aisa plan quote ${plan.planId}`));
    }
  }
}

export async function planDiscoverAction(query: string, options: JsonOptions = {}): Promise<void> {
  const matches = searchCapabilities(query);
  if (options.json) {
    printJson(
      matches.map((contract) => ({
        capability: capabilityRef(contract),
        title: contract.title,
        binding: contract.binding,
        cost:
          contract.costModel.kind === "unknown" ? "unpriced (dynamic)" : contract.costModel.display,
        charge_policy: contract.chargePolicy,
        verification: contract.verification.status,
        verified_at: contract.verification.verifiedAt ?? null,
        sources: contract.verification.sources,
        coverage: contract.dataContract.coverage,
        scope_schema: contract.scopeSchema.map((field) => ({
          name: field.name,
          type: field.type,
          required: field.required,
          default: field.default ?? null,
          values: field.values ?? null,
          description: field.description,
        })),
        known_limits: contract.dataContract.knownLimits,
      }))
    );
    return;
  }

  console.log(`\n  ${chalk.cyan.bold("Capabilities")}`);
  if (matches.length === 0) {
    hint("No capabilities matched. Try a broader query, for example: similarweb");
    return;
  }

  for (const contract of matches) {
    const cost =
      contract.costModel.kind === "unknown" ? "unpriced (dynamic)" : contract.costModel.display;
    // 状态本身已含 "verified" 字样，日期只用括号补充，避免 "verified verified"
    const verifiedAt = contract.verification.verifiedAt
      ? ` (${contract.verification.verifiedAt})`
      : "";
    console.log(`  ${capabilityRef(contract)}`);
    console.log(`    ${contract.title}`);
    console.log(`    Cost: ${cost}`);
    console.log(`    Verification: ${contract.verification.status}${verifiedAt}`);
    console.log(`    Coverage: ${contract.dataContract.coverage.join("; ")}`);
    console.log(
      `    Inputs: ${contract.scopeSchema
        .map((field) => `${field.name}${field.required ? "" : "?"}:${field.type}`)
        .join(", ")}`
    );
    if (contract.dataContract.knownLimits.length > 0) {
      console.log(`    Limits: ${contract.dataContract.knownLimits.join("; ")}`);
    }
    hint(`Add after scope is complete: aisa plan add <plan> ${capabilityRef(contract)} --scope key=value ...`);
  }
}

export async function planAddAction(
  planId: string,
  capability: string,
  options: {
    scope?: string[] | string;
    placeholder?: boolean;
    maxCredits?: string;
    after?: string;
    onDepFailure?: string;
    phase?: string;
    note?: string;
    json?: boolean;
  } = {}
): Promise<void> {
  const plan = loadPlan(planId);
  const resolved = findCapability(capability);
  if (!resolved.contract) {
    throw new Error(resolved.error ?? `unknown capability "${capability}"`);
  }
  if (options.placeholder && !options.maxCredits) {
    throw new Error("placeholder requires --max-credits so the spend bound is explicit");
  }

  const scope = parseScopePairs(options.scope);
  const item: PlanItem = {
    itemId: nextItemId(plan),
    kind: options.placeholder ? "placeholder" : "resource",
    capability: capabilityRef(resolved.contract),
    scope: Object.keys(scope).length > 0 ? scope : undefined,
    phase: options.phase,
    after: parseAfter(options.after),
    onDepFailure: options.onDepFailure ? assertOnDepFailure(options.onDepFailure) : undefined,
    maxCreditMicros: options.maxCredits
      ? parseCreditsToMicros(options.maxCredits, "--max-credits")
      : undefined,
    note: options.note,
  };

  plan.items.push(item);
  plan.nextItemSeq += 1;
  touch(plan);
  savePlan(plan);

  const check = validatePlan(plan);
  const validation = check.items.find((entry) => entry.itemId === item.itemId) ?? {
    itemId: item.itemId,
    status: "invalid" as const,
    errors: ["internal: missing validation for new item"],
    gaps: [],
    warnings: [],
    compiledInputs: {},
    normalizedScope: {},
  };

  if (options.json) {
    printJson({ item: wireItem(item), validation: wireItemValidation(validation) });
    return;
  }

  console.log(`\n  ${chalk.cyan.bold("Item added")}  ${item.itemId}`);
  printItemValidation(item, validation);
  itemValidationHints(validation);
}

export async function planItemReplaceAction(
  planId: string,
  itemId: string,
  options: {
    scope?: string[] | string;
    maxCredits?: string;
    phase?: string;
    note?: string;
    json?: boolean;
  } = {}
): Promise<void> {
  const plan = loadPlan(planId);
  const item = plan.items.find((entry) => entry.itemId === itemId);
  if (!item) {
    throw new Error(`item "${itemId}" not found on plan ${plan.planId}`);
  }

  if (options.scope !== undefined) {
    item.scope = parseScopePairs(options.scope);
    item.kind = "resource";
  }
  if (options.maxCredits !== undefined) {
    item.maxCreditMicros = parseCreditsToMicros(options.maxCredits, "--max-credits");
  }
  if (options.phase !== undefined) item.phase = options.phase;
  if (options.note !== undefined) item.note = options.note;

  touch(plan);
  savePlan(plan);

  const check = validatePlan(plan);
  const validation = check.items.find((entry) => entry.itemId === item.itemId);
  if (!validation) {
    throw new Error(`internal: missing validation for ${item.itemId}`);
  }

  if (options.json) {
    printJson({ item: wireItem(item), validation: wireItemValidation(validation) });
    return;
  }

  console.log(`\n  ${chalk.cyan.bold("Item updated")}  ${item.itemId}`);
  printItemValidation(item, validation);
  itemValidationHints(validation);
}

export async function planItemRemoveAction(planId: string, itemId: string): Promise<void> {
  const plan = loadPlan(planId);
  const index = plan.items.findIndex((entry) => entry.itemId === itemId);
  if (index < 0) {
    throw new Error(`item "${itemId}" not found on plan ${plan.planId}`);
  }

  const dependents = plan.items.filter(
    (entry) => entry.itemId !== itemId && (entry.after ?? []).includes(itemId)
  );
  if (dependents.length > 0) {
    throw new Error(
      `item ${itemId} is referenced by after of ${dependents.map((entry) => entry.itemId).join(", ")} — remove that dependency first`
    );
  }

  plan.items.splice(index, 1);
  touch(plan);
  savePlan(plan);
  success(`Removed ${itemId} from ${plan.planId}`);
}

export async function planSetBudgetAction(
  planId: string,
  credits: string,
  options: { policy?: string } = {}
): Promise<void> {
  const plan = loadPlan(planId);
  plan.budgetCreditMicros = parseCreditsToMicros(credits, "credits");
  if (options.policy !== undefined) {
    plan.budgetPolicy = assertBudgetPolicy(options.policy);
  }
  touch(plan);
  savePlan(plan);
  success(
    `Budget set to ${formatCreditMicros(plan.budgetCreditMicros)} credits (${plan.budgetPolicy}) on ${plan.planId}`
  );
}

export async function planCheckAction(planId: string, options: JsonOptions = {}): Promise<void> {
  const plan = loadPlan(planId);
  const result = validatePlan(plan);

  if (result.status === "invalid" || result.status === "gaps") {
    process.exitCode = 3;
  }

  if (options.json) {
    printJson(wireCheck(result));
    return;
  }

  const label =
    result.status === "valid"
      ? chalk.green("VALID")
      : result.status === "gaps"
        ? chalk.yellow("GAPS")
        : chalk.red("INVALID");
  console.log(`\n  ${chalk.cyan.bold("Plan check")}  ${label}`);

  if (result.planErrors.length > 0) {
    console.log(`\n  Plan errors`);
    for (const err of result.planErrors) console.log(`  - ${err}`);
  }

  for (const item of plan.items) {
    const validation = result.items.find((entry) => entry.itemId === item.itemId);
    if (!validation) continue;
    console.log("");
    printItemValidation(item, validation);
  }

  if (result.status !== "valid") {
    hint("Resolve errors and gaps, then re-run: aisa plan check " + plan.planId);
  }
}

export async function planQuoteAction(planId: string, options: JsonOptions = {}): Promise<void> {
  const plan = loadPlan(planId);
  const result = quotePlan(plan);

  if (!result.ok) {
    process.exitCode = 3;
    if (options.json) {
      printJson(wireProblems(result.problems));
      return;
    }
    console.log(`\n  ${chalk.cyan.bold("Quote blocked")}`);
    for (const problem of result.problems) {
      const who = problem.itemId ?? "plan";
      for (const message of problem.problems) {
        console.log(`  ${who}: ${message}`);
      }
    }
    hint("Fix the problems above, then re-run: aisa plan quote " + plan.planId);
    return;
  }

  const quote = result.quote;
  plan.quote = quote;
  savePlan(plan);

  const nextActions = quoteNextActions(plan, quote);
  if (quote.status === "over_budget") process.exitCode = 2;

  if (options.json) {
    printJson(wireQuote(quote, nextActions));
    return;
  }

  const statusLabel =
    quote.status === "ready" ? chalk.green("READY") : chalk.yellow("OVER BUDGET");
  console.log(`\n  ${chalk.cyan.bold("Quote")}  ${statusLabel}  ${quote.quoteId}`);
  console.log(`  Authority ${quote.authority}  expires ${quote.expiresAt}`);
  console.log(`  Manifest  ${quote.manifestHash}`);
  console.log("");
  console.log(
    table(
      ["ITEM", "CAPABILITY", "ESTIMATE", "MAX", "BASIS"],
      quote.items.map((item) => [
        item.itemId,
        item.capability,
        creditsOrDash(item.estimateCreditMicros),
        formatCreditMicros(item.maxCreditMicros),
        item.basis.display,
      ])
    )
  );
  console.log(
    `\n  Totals  estimate ${formatCreditMicros(quote.totals.estimateCreditMicros)}  max ${formatCreditMicros(quote.totals.maxCreditMicros)}`
  );
  console.log(
    `  Budget  ${creditsOrDash(quote.budgetCheck.budgetCreditMicros)}  headroom ${creditsOrDash(quote.budgetCheck.headroomCreditMicros)}  within=${quote.budgetCheck.withinBudget}`
  );
  if (quote.warnings.length > 0) {
    console.log(`\n  Warnings`);
    for (const warning of quote.warnings) console.log(`  - ${warning}`);
  }
  console.log(`\n  Next actions`);
  nextActions.forEach((action, index) => console.log(`  ${index + 1}. ${action}`));
}

export async function planDeleteAction(planId: string): Promise<void> {
  deletePlan(planId);
  success(`Deleted plan ${planId}`);
}
