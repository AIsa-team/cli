import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCache, writeCache } from "../src/cache.js";
import { getProviderDetail, getProviders } from "../src/catalog.js";

const request = vi.hoisted(() => vi.fn());
vi.mock("../src/api.js", () => ({ publicRequest: request, cacheScope: () => "audit" }));

describe("catalog reference revalidation", () => {
  let directory: string;
  let previousCache: string | undefined;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "aisa-catalog-test-"));
    previousCache = process.env.AISA_CACHE_DIR;
    process.env.AISA_CACHE_DIR = directory;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    request.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (previousCache === undefined) delete process.env.AISA_CACHE_DIR;
    else process.env.AISA_CACHE_DIR = previousCache;
    rmSync(directory, { recursive: true, force: true });
  });

  it("ignores an old 24-hour cache and fetches the current reference", async () => {
    writeCache("catalog/audit/financial.json", { api: { id: "old" } }, 86_400_000);
    request.mockResolvedValue({ status: 200, data: { api: { id: "financial" } }, etag: "new" });
    expect(await getProviderDetail("financial")).toEqual({ id: "financial" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("revalidates both catalog and details after five minutes", async () => {
    request.mockImplementation(async (path: string) => ({ status: 200, etag: path,
      data: path.endsWith("category") ? { apis: [{ id: "financial" }] } : { api: { id: "financial" } } }));
    await getProviders(); await getProviderDetail("financial");
    vi.advanceTimersByTime(299_999);
    await getProviders(); await getProviderDetail("financial");
    expect(request).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    request.mockResolvedValue({ status: 304 });
    await getProviders(); await getProviderDetail("financial");
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[2][1]).toEqual({ etag: "info/apis/category" });
    expect(readCache("catalog-v2/audit/financial.json")?.fresh).toBe(true);
  });

  it("refresh bypasses a fresh local reference", async () => {
    request.mockResolvedValue({ status: 200, data: { api: { id: "financial" } }, etag: "first" });
    await getProviderDetail("financial");
    request.mockResolvedValue({ status: 200, data: { api: { id: "updated" } }, etag: "second" });
    expect(await getProviderDetail("financial", { refresh: true })).toEqual({ id: "updated" });
    expect(request.mock.calls[1][1]).toEqual({ etag: undefined });
  });

  it.each(["transport", "empty response"])("marks a stale fallback explicitly after %s failure", async (failure) => {
    request.mockResolvedValue({ status: 200, data: { api: { id: "financial" } }, etag: "last-good" });
    await getProviderDetail("financial");
    vi.advanceTimersByTime(300_000);
    if (failure === "transport") request.mockRejectedValue(new Error("offline"));
    else request.mockResolvedValue({ status: 503 });
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getProviderDetail("financial")).toEqual({ id: "financial" });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("stale cached reference"));
    expect(readCache("catalog-v2/audit/financial.json")?.fresh).toBe(false);
  });
});
