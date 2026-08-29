import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpFetch, MAX_ATTEMPTS } from "../src/utils/http.js";

/**
 * The retry policy is the part of this wrapper that can do damage if it is
 * wrong. Retrying a read costs a few hundred milliseconds; retrying a write
 * posts a second tweet, mints a second key, or bills a second video job — so
 * the tests that matter most here are the ones asserting that a request does
 * NOT get sent twice.
 */

let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(responses: (Response | Error)[]): void {
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (r instanceof Error) throw r;
    return r;
  });
}

const ok = () => new Response("{}", { status: 200 });
const status = (code: number, headers?: Record<string, string>) =>
  new Response("{}", { status: code, headers });
const netFail = () => new TypeError("fetch failed");

beforeEach(() => {
  calls = [];
  // Backoff sleeps are real timers; keep the suite fast without faking the
  // clock (which would also freeze AbortSignal.timeout).
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("idempotent requests", () => {
  it("retries a network failure up to MAX_ATTEMPTS and then throws", async () => {
    stubFetch([netFail()]);
    await expect(httpFetch("https://api.aisa.one/v1/x", { idempotent: true })).rejects.toThrow();
    expect(calls.length).toBe(MAX_ATTEMPTS);
  });

  it("stops as soon as an attempt succeeds", async () => {
    stubFetch([netFail(), ok()]);
    const res = await httpFetch("https://api.aisa.one/v1/x", { idempotent: true });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });

  it("retries 429 and 5xx", async () => {
    for (const code of [429, 500, 502, 503, 504, 408]) {
      calls = [];
      stubFetch([status(code), ok()]);
      const res = await httpFetch("https://api.aisa.one/v1/x", { idempotent: true });
      expect(res.status, `status ${code} should have been retried`).toBe(200);
      expect(calls.length).toBe(2);
    }
  });

  it("does not retry 4xx — a bad key or parameter fails the same way twice", async () => {
    for (const code of [400, 401, 403, 404, 422]) {
      calls = [];
      stubFetch([status(code)]);
      const res = await httpFetch("https://api.aisa.one/v1/x", { idempotent: true });
      expect(res.status).toBe(code);
      expect(calls.length, `status ${code} should not have been retried`).toBe(1);
    }
  });

  it("gives up rather than parking when Retry-After is longer than the cap", async () => {
    stubFetch([status(503, { "retry-after": "3600" }), ok()]);
    const res = await httpFetch("https://api.aisa.one/v1/x", { idempotent: true });
    expect(res.status).toBe(503);
    expect(calls.length).toBe(1);
  });

  it("honours a short Retry-After and retries", async () => {
    stubFetch([status(429, { "retry-after": "1" }), ok()]);
    const res = await httpFetch("https://api.aisa.one/v1/x", { idempotent: true });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });
});

describe("non-idempotent requests", () => {
  it("is sent exactly once on a network failure — never posts twice", async () => {
    stubFetch([netFail()]);
    await expect(httpFetch("https://api.aisa.one/v1/tweet", { method: "POST" })).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  it("is sent exactly once on a 503, which a retry would duplicate", async () => {
    stubFetch([status(503), ok()]);
    const res = await httpFetch("https://api.aisa.one/v1/tweet", { method: "POST" });
    expect(res.status).toBe(503);
    expect(calls.length).toBe(1);
  });
});

describe("error reporting", () => {
  it("names the host and the attempt count instead of just 'fetch failed'", async () => {
    stubFetch([netFail()]);
    await expect(
      httpFetch("https://api.aisa.one/v1/credits/balance", { idempotent: true })
    ).rejects.toThrow(/api\.aisa\.one.*3 attempts/);
  });

  it("keeps the original error as the cause", async () => {
    const original = netFail();
    stubFetch([original]);
    await httpFetch("https://api.aisa.one/v1/x").catch((e: Error) => {
      expect(e.cause).toBe(original);
    });
  });
});

describe("timeouts", () => {
  it("passes an abort signal on every request", async () => {
    stubFetch([ok()]);
    await httpFetch("https://api.aisa.one/v1/x");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});
