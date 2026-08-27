/**
 * 确定性 grader：只检查磁盘上的 plan 产物（AISA_PLAN_DIR 里的 JSON），
 * 不读 agent 的对话记录、不用 LLM 评判。
 *
 * 评判哲学：plan 文件本身就是机器可校验的合同——quote 状态、预算、
 * manifest、金额全是结构化数据，"任务是否完成"不需要主观判断。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CREDIT_MICROS = 1_000_000;

/** "12" / "0.13" / "7.5" → micros 整数；评测配置里的金额都走这里 */
export function creditsToMicros(text) {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(text).trim());
  if (!m) throw new Error(`invalid credits value in scenario expectation: "${text}"`);
  return Number(m[1]) * CREDIT_MICROS + (m[2] ? Number((m[2] + "000000").slice(0, 6)) : 0);
}

export function microsToCredits(micros) {
  const whole = Math.trunc(micros / CREDIT_MICROS);
  const frac = String(micros % CREDIT_MICROS).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** 读取 plan 目录，返回按 updatedAt 最新的 plan（评测场景一次只产出一个 plan） */
export function loadLatestPlan(planDir) {
  let files;
  try {
    files = readdirSync(planDir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  const plans = [];
  for (const file of files) {
    try {
      plans.push(JSON.parse(readFileSync(join(planDir, file), "utf-8")));
    } catch {
      // 半个 JSON 视为不存在；grader 只认完整产物
    }
  }
  if (plans.length === 0) return null;
  plans.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return plans[0];
}

/** scope 包含性检查：needle 全部出现在对应字段的字符串化值里 */
function scopeContains(scope, needles) {
  for (const [key, expected] of Object.entries(needles)) {
    const actual = String(scope?.[key] ?? "");
    const list = Array.isArray(expected) ? expected : [expected];
    for (const needle of list) {
      if (!actual.includes(String(needle))) return false;
    }
  }
  return true;
}

/**
 * 按场景的 expect 块逐项断言。
 * 返回 { pass, checks: [{check, ok, detail}] }。
 */
export function grade(plan, expect) {
  const checks = [];
  const push = (check, ok, detail) => checks.push({ check, ok, detail });

  if (!plan) {
    push("plan_exists", false, "no plan file was produced in AISA_PLAN_DIR");
    return { pass: false, checks };
  }
  push("plan_exists", true, plan.planId);

  const quote = plan.quote;
  push("quote_exists", Boolean(quote), quote ? quote.quoteId : "plan has no quote");
  if (!quote) return { pass: false, checks };

  // quote 必须对应当前 plan 版本——防止“先报价、再偷改 scope”被算作通过
  push(
    "quote_fresh",
    quote.planVersion === plan.version,
    `quote.planVersion=${quote.planVersion} plan.version=${plan.version}`
  );
  push("quote_authority", quote.authority === "local_preview", String(quote.authority));

  if (expect.quote_status !== undefined) {
    push("quote_status", quote.status === expect.quote_status, `got ${quote.status}, want ${expect.quote_status}`);
  }
  // 能力选型场景用：manifest 必须"不多不少"，防止 agent 靠堆无关 item 蒙混
  if (expect.items_count !== undefined) {
    push("items_count", plan.items.length === expect.items_count, `got ${plan.items.length}, want ${expect.items_count}`);
  }
  if (expect.budget_credits !== undefined) {
    const want = creditsToMicros(expect.budget_credits);
    push(
      "budget_credits",
      plan.budgetCreditMicros === want,
      `got ${plan.budgetCreditMicros == null ? "unset" : microsToCredits(plan.budgetCreditMicros)}, want ${expect.budget_credits}`
    );
  }
  if (expect.totals_within_budget !== undefined) {
    push(
      "totals_within_budget",
      quote.budgetCheck?.withinBudget === expect.totals_within_budget,
      `withinBudget=${quote.budgetCheck?.withinBudget}`
    );
  }
  if (expect.totals_max_credits_lte !== undefined) {
    const bound = creditsToMicros(expect.totals_max_credits_lte);
    push(
      "totals_max_credits_lte",
      quote.totals.maxCreditMicros <= bound,
      `max=${microsToCredits(quote.totals.maxCreditMicros)} bound=${expect.totals_max_credits_lte}`
    );
  }

  for (const [index, wanted] of (expect.items ?? []).entries()) {
    const label = `item[${index}] ${wanted.capability}`;
    const item = plan.items.find(
      (i) => i.capability === wanted.capability && scopeContains(i.scope, wanted.scope_contains ?? {})
    );
    if (!item) {
      push(label, false, "no plan item matches capability + scope_contains");
      continue;
    }
    push(label, true, item.itemId);

    const quoted = quote.items.find((q) => q.itemId === item.itemId);
    if (wanted.estimate_credits !== undefined) {
      const want = creditsToMicros(wanted.estimate_credits);
      push(
        `${label} estimate`,
        quoted?.estimateCreditMicros === want,
        `got ${quoted?.estimateCreditMicros == null ? "null" : microsToCredits(quoted.estimateCreditMicros)}, want ${wanted.estimate_credits}`
      );
    }
    if (wanted.estimate_null === true) {
      push(`${label} estimate_null`, quoted?.estimateCreditMicros == null, String(quoted?.estimateCreditMicros));
    }
    if (wanted.max_credits_set === true) {
      push(`${label} max_credits_set`, item.maxCreditMicros != null, String(item.maxCreditMicros));
    }
    if (wanted.max_credits_lte !== undefined) {
      const bound = creditsToMicros(wanted.max_credits_lte);
      push(
        `${label} max_credits_lte`,
        item.maxCreditMicros != null && item.maxCreditMicros <= bound,
        `got ${item.maxCreditMicros == null ? "unset" : microsToCredits(item.maxCreditMicros)}, bound ${wanted.max_credits_lte}`
      );
    }
  }

  return { pass: checks.every((c) => c.ok), checks };
}
