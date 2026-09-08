import { describe, expect, it } from "vitest";
import { MCP_CLI_MAP, mcpForCommand, projectMcpIdentifiersToCli } from "../src/cli-guidance.js";

/**
 * Exact Router strings from internal/toolrouter/guidance.go (0a72bf8).
 * Used to check that CLI-name projection keeps policy words and conditions.
 */
const SERVER = {
  GuidanceSearchClarify:
    "No currently available operation matched. Clarify the needed capability or provider.",
  GuidanceSearchRetryFilters:
    "No currently available operation matched. This search used provider_filters. Retry AISA_SEARCH_TOOL without provider_filters before treating the capability as unavailable.",
  GuidanceSearchTools:
    "Select the tool that matches the requested capability, date window, and metric. Documented defaults may be used. Ask for required unresolved values; do not guess. If has_full_schema=false, call AISA_BATCH_GET_SCHEMA. Then call AISA_BATCH_QUOTE for those tools and arguments before AISA_BATCH_USE.",
  GuidanceSearchPlan:
    "Follow plan.recommended_steps. Select matching capability, date window, and metric; refine search if the plan or tools are irrelevant. Documented defaults may be used. Ask for required unresolved values; do not guess. If has_full_schema=false, call AISA_BATCH_GET_SCHEMA. Then call AISA_BATCH_QUOTE before AISA_BATCH_USE.",
  omittedSchemaGuidance:
    "If your chosen tool has has_full_schema=false, call AISA_BATCH_GET_SCHEMA before AISA_BATCH_QUOTE.",
  GuidanceSchemaReady:
    "Prepare schema-valid arguments from known inputs, then call AISA_BATCH_QUOTE for those exact tools and arguments. Do not call AISA_BATCH_USE yet.",
  GuidanceSchemaPartial:
    "Some requested tools are missing or unavailable. Identify them and correct via AISA_SEARCH_TOOL. Successful schemas remain usable for quoting. Do not treat the whole batch as failed or as fully succeeded.",
  GuidanceSchemaFailed:
    "Requested schemas are missing or unavailable. Identify the missing tools and correct via AISA_SEARCH_TOOL. Do not quote or execute tools that failed schema lookup.",
  GuidanceQuoteComplete:
    "Present the quoted tools, arguments, and prices. If existing explicit authorization already covers these same calls and cost, call AISA_BATCH_USE with the same calls. If it is missing or inadequate, ask. A data request or credentials alone is not spending approval.",
  GuidanceQuotePartial:
    "This batch is not fully quoted. Do not present a successful-subset subtotal as the full-batch total. Missing or failed quotes are never free. Unquoted calls cannot be executed.",
  GuidanceQuoteAllFailed:
    "No quote succeeded. Correct the calls or fetch quotes again. Missing or failed quotes are never free. Do not call AISA_BATCH_USE.",
  GuidanceQuoteNoGuaranteedMax:
    "One or more quotes report no guaranteed maximum. Estimated cost is not a limit.",
  GuidanceQuoteHardCapNoMax:
    "If a hard monetary cap is required, do not execute calls that have no guaranteed maximum.",
  GuidanceQuoteExecuteQuoted:
    "If existing explicit approval already covers the successfully quoted, selected calls and any cost uncertainty, call AISA_BATCH_USE with only those authorized calls. If that approval is missing or inadequate, ask. A data request or credentials alone is not spending approval.",
  GuidanceUseReportResults:
    "Report the returned business results and any known charges from customer_cost_micros_usd. Omitted charges are unknown, not zero.",
  GuidanceUsePartialOutcome: "This batch is partial: some calls succeeded and some failed.",
  GuidanceUseAllFailedOutcome: "All requested calls failed.",
  GuidanceUseNoRetry:
    "Do not automatically retry or expand the call set. Further billable actions still need a matching quote and covering authorization.",
  retrievalPlan:
    "Follow plan.recommended_steps; for each tool name, find the tools[] entry whose tool field matches. Use its arguments_schema only when has_full_schema=true; otherwise call AISA_BATCH_GET_SCHEMA before AISA_BATCH_QUOTE.",
} as const;

const IDENTIFIERS = Object.values(MCP_CLI_MAP).map((op) => op.identifier);

function expectMapped(input: string, required: string[], mappedTo: string[]): void {
  const out = projectMcpIdentifiersToCli(input);
  for (const phrase of required) {
    expect(out, phrase).toContain(phrase);
  }
  for (const cli of mappedTo) {
    expect(out).toContain(cli);
  }
  for (const id of IDENTIFIERS) {
    if (input.includes(id)) {
      expect(out).not.toContain(id);
    }
  }
}

describe("mcpForCommand path scoping", () => {
  it("matches only top-level Router paths, not nested search leaves", () => {
    expect(mcpForCommand("search")?.identifier).toBe("AISA_SEARCH_TOOL");
    expect(mcpForCommand("schema")?.identifier).toBe("AISA_BATCH_GET_SCHEMA");
    expect(mcpForCommand("quote")?.identifier).toBe("AISA_BATCH_QUOTE");
    expect(mcpForCommand("call")?.identifier).toBe("AISA_BATCH_USE");
    expect(mcpForCommand("api search")).toBeUndefined();
    expect(mcpForCommand("twitter search")).toBeUndefined();
    expect(mcpForCommand("skills search")).toBeUndefined();
    expect(mcpForCommand("aisa")).toBeUndefined();
  });
});

describe("projectMcpIdentifiersToCli", () => {
  it("maps missing-schema search guidance and keeps do-not-guess / schema-false conditions", () => {
    expectMapped(
      SERVER.GuidanceSearchTools,
      [
        "capability",
        "date window",
        "metric",
        "do not guess",
        "has_full_schema=false",
        "those tools and arguments",
      ],
      ["aisa schema", "aisa quote", "aisa call"]
    );
  });

  it("maps plan-bearing search guidance and keeps refine/irrelevant conditions", () => {
    expectMapped(
      SERVER.GuidanceSearchPlan,
      [
        "Follow plan.recommended_steps",
        "refine search if the plan or tools are irrelevant",
        "do not guess",
        "has_full_schema=false",
      ],
      ["aisa schema", "aisa quote", "aisa call"]
    );
  });

  it("maps omitted-schema and schema-ready / failed / partial conditions", () => {
    expectMapped(
      SERVER.omittedSchemaGuidance,
      ["has_full_schema=false", "before"],
      ["aisa schema", "aisa quote"]
    );
    expectMapped(
      SERVER.GuidanceSchemaReady,
      ["schema-valid arguments", "those exact tools and arguments", "Do not call", "yet"],
      ["aisa quote", "aisa call"]
    );
    expectMapped(
      SERVER.GuidanceSchemaPartial,
      [
        "Successful schemas remain usable for quoting",
        "Do not treat the whole batch as failed or as fully succeeded",
      ],
      ["aisa search"]
    );
    expectMapped(
      SERVER.GuidanceSchemaFailed,
      ["Do not quote or execute tools that failed schema lookup"],
      ["aisa search"]
    );
  });

  it("maps complete quote approval text and keeps prior-approval / credentials negation", () => {
    expectMapped(
      SERVER.GuidanceQuoteComplete,
      [
        "If existing explicit authorization already covers these same calls and cost",
        "If it is missing or inadequate, ask",
        "A data request or credentials alone is not spending approval",
      ],
      ["aisa call"]
    );
  });

  it("keeps partial / missing / uncertain price words after mapping", () => {
    expectMapped(
      SERVER.GuidanceQuotePartial,
      [
        "This batch is not fully quoted",
        "successful-subset subtotal",
        "Missing or failed quotes are never free",
        "Unquoted calls cannot be executed",
      ],
      []
    );
    expectMapped(
      SERVER.GuidanceQuoteAllFailed,
      ["Missing or failed quotes are never free", "Do not call"],
      ["aisa call"]
    );
    expectMapped(
      SERVER.GuidanceQuoteNoGuaranteedMax,
      ["no guaranteed maximum", "Estimated cost is not a limit"],
      []
    );
    expectMapped(
      SERVER.GuidanceQuoteHardCapNoMax,
      ["hard monetary cap", "no guaranteed maximum"],
      []
    );
    expectMapped(
      SERVER.GuidanceQuoteExecuteQuoted,
      [
        "successfully quoted, selected calls",
        "any cost uncertainty",
        "only those authorized calls",
        "A data request or credentials alone is not spending approval",
      ],
      ["aisa call"]
    );
  });

  it("leaves identifier-free use/search strings byte-identical", () => {
    for (const line of [
      SERVER.GuidanceSearchClarify,
      SERVER.GuidanceQuotePartial,
      SERVER.GuidanceQuoteNoGuaranteedMax,
      SERVER.GuidanceQuoteHardCapNoMax,
      SERVER.GuidanceUseReportResults,
      SERVER.GuidanceUsePartialOutcome,
      SERVER.GuidanceUseAllFailedOutcome,
      SERVER.GuidanceUseNoRetry,
      "custom unknown sentence with no identifiers",
    ]) {
      expect(projectMcpIdentifiersToCli(line)).toBe(line);
    }
  });

  it("maps retry-without-filters and retrieval plan pitfalls without rewriting other tokens", () => {
    expectMapped(
      SERVER.GuidanceSearchRetryFilters,
      ["without provider_filters", "before treating the capability as unavailable"],
      ["aisa search"]
    );
    expectMapped(
      SERVER.retrievalPlan,
      ["has_full_schema=true", "tools[]", "arguments_schema"],
      ["aisa schema", "aisa quote"]
    );
    expect(projectMcpIdentifiersToCli("AISA_BATCH_CONCURRENCY must stay")).toBe(
      "AISA_BATCH_CONCURRENCY must stay"
    );
    expect(projectMcpIdentifiersToCli("prefix_AISA_BATCH_USE_suffix")).toBe(
      "prefix_AISA_BATCH_USE_suffix"
    );
  });
});
