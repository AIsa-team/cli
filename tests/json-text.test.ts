import { describe, expect, it } from "vitest";
import { numberToken, parseJsonKeepingNumberTokens, quoteNumberTokens } from "../src/json-text.js";

const BIG = "9007199254740993";

describe("parseJsonKeepingNumberTokens", () => {
  it("keeps integer tokens at their structural path, including values above 2^53", () => {
    const raw = `{"results":[{"data":{"estimated_cost_micros_usd":7}},{"data":{"estimated_cost_micros_usd":${BIG}}}]}`;
    const parsed = parseJsonKeepingNumberTokens(raw) as {
      results: Array<{ data: { estimated_cost_micros_usd: unknown } }>;
    };
    expect(numberToken(parsed.results[0].data.estimated_cost_micros_usd)).toBe("7");
    expect(numberToken(parsed.results[1].data.estimated_cost_micros_usd)).toBe(BIG);
  });

  it("does not treat digits inside strings as numbers", () => {
    const raw = `{"call_id":"cost-${BIG}","n":1}`;
    const parsed = parseJsonKeepingNumberTokens(raw) as { call_id: string; n: unknown };
    expect(parsed.call_id).toBe(`cost-${BIG}`);
    expect(numberToken(parsed.n)).toBe("1");
    expect(quoteNumberTokens(raw)).toContain(`"cost-${BIG}"`);
  });
});
