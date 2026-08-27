import { describe, expect, it } from "vitest";
import { formatPrice } from "../src/catalog.js";

describe("formatPrice", () => {
  it("renders missing prices as an em dash, never as free", () => {
    expect(formatPrice(null as unknown as undefined)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
  });

  it("treats catalog zero as unpriced dynamic billing, not free", () => {
    // live catalog 里动态计费 endpoint 会带 pricing.normal = 0，无法核实是否真免费。
    expect(formatPrice(0)).toBe("unpriced (dynamic)");
  });

  it("keeps two significant digits and never uses exponent notation", () => {
    expect(formatPrice(0.03)).toBe("$0.03");
    expect(formatPrice(0.000001)).toBe("$0.000001");
    expect(formatPrice(0.08)).toBe("$0.08");
    expect(formatPrice(0.00044)).toBe("$0.00044");
    expect(formatPrice(0.012)).toBe("$0.012");
  });
});
