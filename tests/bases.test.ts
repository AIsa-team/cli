import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBases, cacheScope } from "../src/api.js";
import * as config from "../src/config.js";
import { formatPrice } from "../src/catalog.js";

describe("resolveBases", () => {
  afterEach(() => vi.restoreAllMocks());

  it("handles the historical default that is already persisted in user configs", () => {
    // conf's schema default has always been ".../v1", so every existing install
    // has that exact string on disk; changing the schema does not rewrite it.
    vi.spyOn(config, "getConfig").mockReturnValue("https://api.aisa.one/v1");

    expect(resolveBases()).toEqual({
      llm: "https://api.aisa.one/v1",
      domain: "https://api.aisa.one/apis/v1",
      info: "https://api.aisa.one",
    });
  });

  it("accepts a bare root, a trailing slash, or an /apis/v1 suffix", () => {
    for (const value of [
      "https://self.hosted",
      "https://self.hosted/",
      "https://self.hosted/v1",
      "https://self.hosted/apis/v1",
    ]) {
      vi.spyOn(config, "getConfig").mockReturnValue(value);
      expect(resolveBases()).toEqual({
        llm: "https://self.hosted/v1",
        domain: "https://self.hosted/apis/v1",
        info: "https://self.hosted",
      });
    }
  });

  it("falls back to the built-in root when unset", () => {
    vi.spyOn(config, "getConfig").mockReturnValue(undefined);
    expect(resolveBases().info).toBe("https://api.aisa.one");
  });
});

describe("cacheScope", () => {
  afterEach(() => vi.restoreAllMocks());

  it("changes with the configured gateway, so caches cannot cross hosts", () => {
    // Catalog entries live up to 24h; a fixed cache key would keep serving one
    // server's catalog after `config set baseUrl` points at another.
    vi.spyOn(config, "getConfig").mockReturnValue("https://api.aisa.one/v1");
    const prod = cacheScope();

    vi.spyOn(config, "getConfig").mockReturnValue("https://self.hosted:8080/v1");
    const selfHosted = cacheScope();

    expect(prod).not.toBe(selfHosted);
    expect(prod).toBe("api.aisa.one");
  });

  it("yields filesystem-safe path segments", () => {
    vi.spyOn(config, "getConfig").mockReturnValue("https://self.hosted:8080/v1");
    expect(cacheScope()).toMatch(/^[\w.-]+$/);
  });
});

describe("formatPrice", () => {
  it("keeps sub-cent prices legible instead of rounding them to zero", () => {
    // Real catalog values: rounding to 2dp would print every one of these as $0.00.
    expect(formatPrice(0.00044)).toBe("$0.00044");
    expect(formatPrice(0.000001)).toBe("$0.000001");
    expect(formatPrice(0.00001)).toBe("$0.00001");
    expect(formatPrice(0.008)).toBe("$0.008");
    expect(formatPrice(0.012)).toBe("$0.012");
    expect(formatPrice(0.08)).toBe("$0.08");
    expect(formatPrice(0)).toBe("free");
    expect(formatPrice(undefined)).toBe("—");
  });
});
