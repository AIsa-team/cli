import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { grade } from "../eval/grade.mjs";
import {
  exportSuite,
  loadSuite,
  passRuleFor,
  scoreTrials,
  selectScenarios,
  validateSuite,
} from "../eval/load-suite.mjs";
import { parseArgs } from "../eval/run.mjs";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("eval/suite.json", () => {
  const suite = loadSuite();

  it("loads as the single source of truth", () => {
    expect(suite.version).toBe(1);
    expect(suite.name).toBe("aisa-plan-cli");
    expect(validateSuite(suite)).toEqual([]);
  });

  it("keeps unique ids and all three inherited suites", () => {
    const ids = suite.scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(selectScenarios(suite, { suiteKind: "regression" }).length).toBeGreaterThanOrEqual(8);
    expect(selectScenarios(suite, { suiteKind: "capability" }).length).toBeGreaterThanOrEqual(6);
    expect(selectScenarios(suite, { suiteKind: "natural" }).map((s) => s.id)).toEqual([
      "n1_natural_traffic_quote",
      "n2_natural_budget_negotiation",
      "n3_natural_unverified_pricing",
      "n4_natural_capability_fit",
    ]);
  });

  it("exports a re-loadable JSON document", () => {
    const dir = mkdtempSync(join(tmpdir(), "aisa-eval-export-"));
    temps.push(dir);
    const path = join(dir, "suite.json");
    writeFileSync(path, exportSuite(suite));
    const reloaded = loadSuite(path);
    expect(reloaded.scenarios.map((s) => s.id).sort()).toEqual(
      suite.scenarios.map((s) => s.id).sort()
    );
  });

  it("uses pass^k for regression agents and pass@k for capability/natural", () => {
    expect(passRuleFor(suite.standards, "scripted", "regression")).toBe("pass_hat_k");
    expect(passRuleFor(suite.standards, "agent", "regression")).toBe("pass_hat_k");
    expect(passRuleFor(suite.standards, "agent", "capability")).toBe("pass_at_k");
    expect(passRuleFor(suite.standards, "agent", "natural")).toBe("pass_at_k");
  });
});

describe("scoreTrials", () => {
  it("diverges pass@k and pass^k after the first trial", () => {
    expect(scoreTrials([true, false, true])).toEqual({
      k: 3,
      successes: 2,
      pass_rate: 2 / 3,
      pass_at_k: true,
      pass_hat_k: false,
    });
    expect(scoreTrials([true, true, true]).pass_hat_k).toBe(true);
    expect(scoreTrials([false, false]).pass_at_k).toBe(false);
  });
});

describe("grade forbidden_capabilities", () => {
  it("fails when a forbidden capability is present", () => {
    const plan = {
      planId: "pln_test0001",
      version: 2,
      items: [
        { itemId: "itm_01", capability: "similarweb.demographics@1", scope: { domain: "stripe.com" } },
        { itemId: "itm_02", capability: "web_search.tavily@1", scope: { query: "stripe" } },
      ],
      quote: {
        quoteId: "qte_test",
        planVersion: 2,
        authority: "local_preview",
        status: "ready",
        totals: { estimateCreditMicros: 8_000_000, maxCreditMicros: 8_000_000 },
        budgetCheck: { withinBudget: true },
        items: [
          { itemId: "itm_01", estimateCreditMicros: 8_000_000 },
          { itemId: "itm_02", estimateCreditMicros: null },
        ],
      },
    };
    const graded = grade(plan, {
      quote_status: "ready",
      forbidden_capabilities: ["web_search.tavily@1"],
      items: [
        { capability: "similarweb.demographics@1", scope_contains: { domain: "stripe.com" } },
      ],
    });
    expect(graded.pass).toBe(false);
    expect(graded.checks.find((c) => c.check === "forbidden web_search.tavily@1")?.ok).toBe(false);
  });
});

describe("parseArgs", () => {
  it("keeps --suite natural from the inherited NL eval", () => {
    expect(parseArgs(["--suite", "natural", "--trials", "3"])).toMatchObject({
      suiteKind: "natural",
      trials: 3,
    });
  });
});
