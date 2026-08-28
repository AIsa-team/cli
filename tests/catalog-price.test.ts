import { describe, expect, it } from "vitest";
import { presentCatalogPrice } from "../src/pricing.js";

describe("presentCatalogPrice", () => {
  it("requires an estimate for Similarweb even when its catalog display value is positive", () => {
    expect(presentCatalogPrice("similarweb", 0.1)).toEqual({
      kind: "estimate_required",
      catalogUsd: 0.1,
      label: "estimate required",
    });
  });

  it("never treats a zero catalog value as free", () => {
    expect(presentCatalogPrice("financial", 0)).toEqual({
      kind: "estimate_required",
      catalogUsd: 0,
      label: "estimate required",
    });
  });

  it("keeps ordinary positive catalog prices as fixed display values", () => {
    expect(presentCatalogPrice("tavily", 0.0096)).toEqual({
      kind: "fixed",
      catalogUsd: 0.0096,
      label: "$0.0096",
    });
  });
});
