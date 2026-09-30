import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routerPost } from "../src/router.js";
import { httpFetch, INFO_TIMEOUT_MS } from "../src/utils/http.js";

vi.mock("../src/config.js", () => ({
  getConfig: () => undefined,
  refreshAccessToken: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  // Node's native AbortSignal timeout does not use the mocked clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Expired", "TimeoutError")), ms);
    return controller.signal;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function slowFetch(delayMs: number) {
  const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response('{"ok":true}')), delayMs);
    init.signal!.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init.signal!.reason);
    }, { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("HTTP timeout budgets", () => {
  it("lets a Router use response finish after the old 30-second cutoff", async () => {
    const fetch = slowFetch(45_000);
    const pending = routerPost({ operation: "call", body: '{"calls":[]}' });
    const result = expect(pending).resolves.toEqual({ status: 200, raw: '{"ok":true}' });
    await vi.advanceTimersByTimeAsync(45_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled Router use at 600 seconds without retrying", async () => {
    const fetch = slowFetch(700_000);
    let settled = false;
    const pending = routerPost({ operation: "call", body: '{"calls":[]}' }).finally(() => { settled = true; });
    const result = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([25, INFO_TIMEOUT_MS])("honours an explicit %i ms timeout", async (timeoutMs) => {
    const fetch = slowFetch(700_000);
    const result = expect(httpFetch("https://example.test/info", { timeoutMs })).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(timeoutMs);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
