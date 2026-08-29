import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewer, checkForUpdate } from "../src/utils/update-check.js";
import { writeCache } from "../src/cache.js";

describe("isNewer", () => {
  it("detects a newer patch, minor, and major version", () => {
    expect(isNewer("0.3.1", "0.3.0")).toBe(true);
    expect(isNewer("0.4.0", "0.3.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  });

  it("is false for equal or older versions", () => {
    expect(isNewer("0.3.0", "0.3.0")).toBe(false);
    expect(isNewer("0.2.9", "0.3.0")).toBe(false);
  });

  it("compares numerically, not lexically (0.10.0 > 0.9.0)", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("0.9.0", "0.10.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  let cacheDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "aisa-update-check-"));
    origEnv = process.env.AISA_CACHE_DIR;
    process.env.AISA_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.AISA_CACHE_DIR;
    else process.env.AISA_CACHE_DIR = origEnv;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns the latest version when it is newer than current", async () => {
    const result = await checkForUpdate({ current: "0.3.0", fetchLatest: async () => "0.4.0" });
    expect(result).toBe("0.4.0");
  });

  it("returns undefined when already current", async () => {
    const result = await checkForUpdate({ current: "0.3.0", fetchLatest: async () => "0.3.0" });
    expect(result).toBeUndefined();
  });

  it("caches the result so a second call within the TTL never fetches again", async () => {
    let calls = 0;
    const fetchLatest = async () => {
      calls++;
      return "0.4.0";
    };
    await checkForUpdate({ current: "0.3.0", fetchLatest });
    const second = await checkForUpdate({ current: "0.3.0", fetchLatest });
    expect(calls).toBe(1);
    expect(second).toBe("0.4.0");
  });

  it("never throws and reports nothing when the fetch fails and there is no cache", async () => {
    const result = await checkForUpdate({
      current: "0.3.0",
      fetchLatest: async () => {
        throw new Error("offline");
      },
    });
    expect(result).toBeUndefined();
  });

  it("falls back to a stale cached value when the registry is unreachable", async () => {
    writeCache("update-check", { latest: "0.4.0" }, -1); // already expired
    const result = await checkForUpdate({
      current: "0.3.0",
      fetchLatest: async () => {
        throw new Error("offline");
      },
    });
    expect(result).toBe("0.4.0");
  });
});
