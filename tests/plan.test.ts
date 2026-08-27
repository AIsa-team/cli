import { describe, expect, it } from "vitest";
import { buildSimilarwebTrafficPlan } from "../src/commands/plan.js";

describe("Similarweb Traffic & Engagement credit plan", () => {
  it("calculates inclusive monthly buckets and one credit per metric/bucket", () => {
    const plan = buildSimilarwebTrafficPlan({
      domain: "openai.com",
      country: "us",
      start: "2026-07",
      end: "2026-09",
      metrics: "visits,average_visit_duration",
    });

    expect(plan.status).toBe("ready");
    expect(plan.summary).toMatchObject({ estimate_credits: 6, max_credits: 6 });
    expect(plan.scope).toMatchObject({ country: "us", time_buckets: 3, metrics: ["visits", "average_visit_duration"] });
    expect(plan.evidence.pricing_formula).toContain("metrics × countries × monthly time buckets");
  });

  it("marks a plan over budget without changing its maximum", () => {
    const plan = buildSimilarwebTrafficPlan({
      domain: "openai.com",
      start: "2026-07",
      end: "2026-07",
      metrics: "visits,average_visit_duration",
      maxCredits: "1",
    });

    expect(plan.status).toBe("over_budget");
    expect(plan.summary).toMatchObject({ estimate_credits: 2, max_credits: 2, budget_credits: 1 });
  });

  it("normalizes public world aliases and removes duplicate metrics", () => {
    const plan = buildSimilarwebTrafficPlan({
      domain: "openai.com",
      country: "global",
      start: "2026-07",
      end: "2026-07",
      metrics: "visits,visits",
    });

    expect(plan.scope.country).toBe("world");
    expect(plan.scope.metrics).toEqual(["visits"]);
    expect(plan.summary.max_credits).toBe(1);
  });

  it("rejects unsupported or unbounded P0 input", () => {
    expect(() => buildSimilarwebTrafficPlan({
      domain: "openai.com",
      start: "2026-07",
      end: "2026-07",
      granularity: "daily",
      metrics: "visits",
    })).toThrow("monthly only");

    expect(() => buildSimilarwebTrafficPlan({
      domain: "https://openai.com/path",
      start: "2026-07",
      end: "2026-07",
      metrics: "visits",
    })).toThrow("hostname");
  });
});
