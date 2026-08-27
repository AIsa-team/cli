import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeQuoteFreshness,
  formatCreditMicros,
  parseCreditsToMicros,
  quotePlan,
  validatePlan,
} from "../src/plan/engine.js";
import type { Plan, PlanItem } from "../src/plan/model.js";
import { CREDIT_MICROS } from "../src/plan/registry.js";
import { deletePlan, listPlans, loadPlan, savePlan } from "../src/plan/store.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    schema: 1,
    planId: "pln_test0001",
    version: 1,
    status: "draft",
    budgetPolicy: "hard",
    items: [],
    nextItemSeq: 1,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function trafficItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    itemId: "itm_01",
    kind: "resource",
    capability: "similarweb.traffic_engagement@1",
    scope: {
      domain: "notion.so",
      metrics: "visits,bounce_rate",
      country: "world",
      start: "2026-02",
      end: "2026-07",
    },
    ...overrides,
  };
}

describe("parseCreditsToMicros / formatCreditMicros", () => {
  it("accepts 12 / 0.13 / 7.5", () => {
    expect(parseCreditsToMicros("12", "credits")).toBe(12 * CREDIT_MICROS);
    expect(parseCreditsToMicros("0.13", "credits")).toBe(130_000);
    expect(parseCreditsToMicros("7.5", "credits")).toBe(7_500_000);
    expect(formatCreditMicros(12 * CREDIT_MICROS)).toBe("12");
    expect(formatCreditMicros(130_000)).toBe("0.13");
    expect(formatCreditMicros(7_500_000)).toBe("7.5");
  });

  it("rejects 0 / -1 / too many fractional digits / non-numeric", () => {
    const label = "credits";
    for (const value of ["0", "-1", "1.2345678", "abc"]) {
      expect(() => parseCreditsToMicros(value, label)).toThrow(
        `${label} must be a positive decimal with at most six fractional digits`
      );
    }
  });
});

describe("quotePlan cost models", () => {
  it("prices traffic_engagement as 2 metrics × 6 buckets × 1 country = 12 credits", () => {
    const plan = makePlan({ items: [trafficItem()] });
    const result = quotePlan(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.quote.items[0];
    expect(item.estimateCreditMicros).toBe(12 * CREDIT_MICROS);
    expect(item.maxCreditMicros).toBe(12 * CREDIT_MICROS);
    expect(item.basis.display).toContain("2 metrics");
    expect(item.basis.display).toContain("6 monthly buckets");
    expect(item.basis.display).toMatch(/= 12$/);
  });

  it("bounds referrals at provider 60 and item cap 30", () => {
    const uncapped = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "resource",
          capability: "similarweb.referrals@1",
          scope: { domain: "notion.so" },
        },
      ],
    });
    const uncappedQuote = quotePlan(uncapped);
    expect(uncappedQuote.ok).toBe(true);
    if (!uncappedQuote.ok) return;
    expect(uncappedQuote.quote.items[0].maxCreditMicros).toBe(60 * CREDIT_MICROS);
    expect(uncappedQuote.quote.items[0].estimateCreditMicros).toBe(60 * CREDIT_MICROS);

    const capped = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "resource",
          capability: "similarweb.referrals@1",
          scope: { domain: "notion.so" },
          maxCreditMicros: 30 * CREDIT_MICROS,
        },
      ],
    });
    const cappedQuote = quotePlan(capped);
    expect(cappedQuote.ok).toBe(true);
    if (!cappedQuote.ok) return;
    expect(cappedQuote.quote.items[0].maxCreditMicros).toBe(30 * CREDIT_MICROS);
    expect(cappedQuote.quote.items[0].estimateCreditMicros).toBe(30 * CREDIT_MICROS);
  });

  it("compiles a run_command handoff with wire param names and filled defaults", () => {
    const plan = makePlan({
      items: [
        trafficItem({
          scope: {
            domain: "openai.com",
            metrics: "visits",
            country: "us",
            start: "2026-07",
            end: "2026-07",
          },
        }),
      ],
    });
    const result = quotePlan(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.items[0].runCommand).toBe(
      'aisa run similarweb website/traffic-engagement -q "domain=openai.com&metrics=visits&country=us&start_date=2026-07&end_date=2026-07&granularity=monthly&main_domain_only=true"'
    );
  });

  it("omits run_command for placeholders", () => {
    const plan = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "placeholder",
          capability: "similarweb.traffic_engagement@1",
          maxCreditMicros: 5 * CREDIT_MICROS,
        },
      ],
    });
    const result = quotePlan(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.items[0].runCommand).toBeNull();
  });

  it("prices demographics as a fixed 8 credits", () => {
    const plan = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "resource",
          capability: "similarweb.demographics@1",
          scope: { domain: "notion.so" },
        },
      ],
    });
    const result = quotePlan(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.items[0].estimateCreditMicros).toBe(8 * CREDIT_MICROS);
    expect(result.quote.items[0].maxCreditMicros).toBe(8 * CREDIT_MICROS);
  });

  it("blocks unknown pricing without a cap and quotes cap-only with a cap", () => {
    const open = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "resource",
          capability: "web_search.tavily@1",
          scope: { query: "notion pricing" },
        },
      ],
    });
    const check = validatePlan(open);
    expect(check.items[0].gaps.some((gap) => gap.reason === "unverified_pricing")).toBe(true);
    const blocked = quotePlan(open);
    expect(blocked.ok).toBe(false);

    const capped = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "resource",
          capability: "web_search.tavily@1",
          scope: { query: "notion pricing" },
          maxCreditMicros: 20 * CREDIT_MICROS,
        },
      ],
    });
    const quoted = quotePlan(capped);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.quote.items[0].estimateCreditMicros).toBeNull();
    expect(quoted.quote.items[0].maxCreditMicros).toBe(20 * CREDIT_MICROS);
  });

  it("treats placeholder gaps as non-blocking and excludes them from estimate", () => {
    const missingCap = makePlan({
      items: [
        {
          itemId: "itm_01",
          kind: "placeholder",
          capability: "web_search.tavily@1",
        },
      ],
    });
    const invalid = validatePlan(missingCap);
    expect(invalid.items[0].status).toBe("invalid");
    expect(quotePlan(missingCap).ok).toBe(false);

    const placeholder = makePlan({
      budgetCreditMicros: 150 * CREDIT_MICROS,
      items: [
        trafficItem(),
        {
          itemId: "itm_02",
          kind: "placeholder",
          capability: "web_search.tavily@1",
          maxCreditMicros: 20 * CREDIT_MICROS,
        },
      ],
    });
    const check = validatePlan(placeholder);
    expect(check.status).toBe("gaps");
    expect(check.items[1].gaps.some((gap) => gap.reason === "needs_upstream_result")).toBe(true);

    const quoted = quotePlan(placeholder);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.quote.totals.estimateCreditMicros).toBe(12 * CREDIT_MICROS);
    expect(quoted.quote.totals.maxCreditMicros).toBe(32 * CREDIT_MICROS);
    expect(quoted.quote.items[1].estimateCreditMicros).toBeNull();
    expect(quoted.quote.items[1].maxCreditMicros).toBe(20 * CREDIT_MICROS);
  });
});

describe("quotePlan budget and caps", () => {
  it("marks hard budget over_budget and advisory ready with a warning", () => {
    const items: PlanItem[] = [
      {
        itemId: "itm_01",
        kind: "resource",
        capability: "similarweb.demographics@1",
        scope: { domain: "notion.so" },
      },
    ];
    const hard = quotePlan(
      makePlan({ items, budgetCreditMicros: 5 * CREDIT_MICROS, budgetPolicy: "hard" })
    );
    expect(hard.ok).toBe(true);
    if (!hard.ok) return;
    expect(hard.quote.status).toBe("over_budget");
    expect(hard.quote.budgetCheck.withinBudget).toBe(false);

    const advisory = quotePlan(
      makePlan({ items, budgetCreditMicros: 5 * CREDIT_MICROS, budgetPolicy: "advisory" })
    );
    expect(advisory.ok).toBe(true);
    if (!advisory.ok) return;
    expect(advisory.quote.status).toBe("ready");
    expect(advisory.quote.warnings.some((warning) => warning.includes("advisory"))).toBe(true);
  });

  it("blocks quote when an exact-cost item cap is below the price", () => {
    const plan = makePlan({
      items: [trafficItem({ maxCreditMicros: 5 * CREDIT_MICROS })],
    });
    const result = quotePlan(plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].problems.join(" ")).toMatch(/item cap 5 is below the exact price 12/);
  });
});

describe("manifest hash", () => {
  it("is stable for the same plan and changes when scope or budget changes", () => {
    const plan = makePlan({
      budgetCreditMicros: 150 * CREDIT_MICROS,
      items: [trafficItem()],
    });
    const first = quotePlan(plan);
    const second = quotePlan(plan);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.quote.manifestHash).toBe(second.quote.manifestHash);
    expect(first.quote.manifestHash.startsWith("sha256:")).toBe(true);

    const scopeChanged = makePlan({
      ...plan,
      version: plan.version + 1,
      items: [trafficItem({ scope: { ...trafficItem().scope, metrics: "visits" } })],
    });
    const afterScope = quotePlan(scopeChanged);
    expect(afterScope.ok).toBe(true);
    if (!afterScope.ok) return;
    expect(afterScope.quote.manifestHash).not.toBe(first.quote.manifestHash);

    const budgetChanged = makePlan({
      ...plan,
      budgetCreditMicros: 40 * CREDIT_MICROS,
    });
    const afterBudget = quotePlan(budgetChanged);
    expect(afterBudget.ok).toBe(true);
    if (!afterBudget.ok) return;
    expect(afterBudget.quote.manifestHash).not.toBe(first.quote.manifestHash);
  });
});

describe("after dependencies", () => {
  it("reports a missing after reference as a plan error", () => {
    const plan = makePlan({
      items: [trafficItem({ after: ["itm_99"] })],
    });
    const check = validatePlan(plan);
    expect(check.status).toBe("invalid");
    expect(check.planErrors.some((error) => error.includes("itm_99"))).toBe(true);
  });

  it("reports a cyclic after dependency as a plan error", () => {
    const plan = makePlan({
      items: [
        trafficItem({ itemId: "itm_01", after: ["itm_02"] }),
        {
          itemId: "itm_02",
          kind: "resource",
          capability: "similarweb.demographics@1",
          scope: { domain: "notion.so" },
          after: ["itm_01"],
        },
      ],
    });
    const check = validatePlan(plan);
    expect(check.status).toBe("invalid");
    expect(check.planErrors.some((error) => error.includes("cycle"))).toBe(true);
  });
});

describe("describeQuoteFreshness", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");

  it("returns none / fresh / stale / expired", () => {
    const bare = makePlan();
    expect(describeQuoteFreshness(bare, now)).toBe("none");

    const quoted = quotePlan(makePlan({ items: [trafficItem()] }), now);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;

    const withQuote = makePlan({ items: [trafficItem()], quote: quoted.quote });
    expect(describeQuoteFreshness(withQuote, now)).toBe("fresh");

    const bumped = makePlan({ items: [trafficItem()], version: 2, quote: quoted.quote });
    expect(describeQuoteFreshness(bumped, now)).toBe("stale");

    const expired = makePlan({
      items: [trafficItem()],
      quote: { ...quoted.quote, expiresAt: "2026-08-27T11:00:00.000Z" },
    });
    expect(describeQuoteFreshness(expired, now)).toBe("expired");
  });
});

describe("plan store round-trip", () => {
  let dir: string;
  const previous = process.env.AISA_PLAN_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aisa-plans-"));
    process.env.AISA_PLAN_DIR = dir;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.AISA_PLAN_DIR;
    else process.env.AISA_PLAN_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves, lists, loads, and deletes a plan", () => {
    const plan = makePlan({
      planId: "pln_abcd1234",
      items: [trafficItem()],
      nextItemSeq: 2,
    });
    savePlan(plan);
    const listed = listPlans();
    expect(listed.map((entry) => entry.planId)).toEqual(["pln_abcd1234"]);
    expect(loadPlan("pln_abcd1234").items[0].capability).toBe("similarweb.traffic_engagement@1");
    deletePlan("pln_abcd1234");
    expect(listPlans()).toEqual([]);
  });
});
