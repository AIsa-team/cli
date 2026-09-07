import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../src/config.js";
import {
  DEFAULT_ROUTER_URL,
  ROUTER_PATHS,
  ROUTER_URL_ENV,
  resolveRouterBase,
  routerPost,
} from "../src/router.js";

describe("resolveRouterBase", () => {
  afterEach(() => {
    delete process.env[ROUTER_URL_ENV];
    vi.restoreAllMocks();
  });

  it("reads AISA_ROUTER_BASE_URL as the origin before /v1/tool-router paths", () => {
    process.env[ROUTER_URL_ENV] = "http://127.0.0.1:18080/";
    vi.spyOn(config, "getConfig").mockReturnValue("https://should-not-win");
    expect(resolveRouterBase()).toBe("http://127.0.0.1:18080");
    expect(ROUTER_URL_ENV).toBe("AISA_ROUTER_BASE_URL");
  });

  it("uses config routerUrl when the env is unset", () => {
    vi.spyOn(config, "getConfig").mockImplementation((key) =>
      key === "routerUrl" ? "http://router.local:8080" : undefined
    );
    expect(resolveRouterBase()).toBe("http://router.local:8080");
  });

  it("defaults to the OpenAPI production origin, not the LLM /v1 base", () => {
    vi.spyOn(config, "getConfig").mockReturnValue("");
    expect(resolveRouterBase()).toBe(DEFAULT_ROUTER_URL);
    expect(resolveRouterBase()).not.toMatch(/\/v1$/);
  });

  it("does not follow baseUrl /apis/v1 or /v1 rewriting", () => {
    vi.spyOn(config, "getConfig").mockImplementation((key) =>
      key === "baseUrl" ? "https://self.hosted/apis/v1" : ""
    );
    expect(resolveRouterBase()).toBe(DEFAULT_ROUTER_URL);
  });
});

describe("routerPost", () => {
  let calls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    calls = [];
    process.env[ROUTER_URL_ENV] = "http://router.test";
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);
  });

  afterEach(() => {
    delete process.env[ROUTER_URL_ENV];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it("posts each operation to its mapped path and never retries", async () => {
    stubFetch([new Response("{}", { status: 503 }), new Response("{}", { status: 200 })]);

    for (const [operation, path] of Object.entries(ROUTER_PATHS)) {
      calls = [];
      stubFetch([new Response("{}", { status: 503 })]);
      const res = await routerPost({
        operation: operation as keyof typeof ROUTER_PATHS,
        body: '{"query":"x"}',
      });
      expect(res.status).toBe(503);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`http://router.test${path}`);
      expect(calls[0].init.method).toBe("POST");
      expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    }
  });

  it("sends the raw body and optional Bearer credential", async () => {
    const body = '{"calls":[{"call_id":"c1","tool":"t","arguments":{"n":9007199254740993}}]}';
    stubFetch([new Response(body, { status: 200 })]);

    const res = await routerPost({ operation: "quote", body, apiKey: "sk-test" });
    expect(calls[0].init.body).toBe(body);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(res.raw).toBe(body);
  });

  it("omits Authorization when no key is supplied", async () => {
    stubFetch([new Response("{}", { status: 200 })]);
    await routerPost({ operation: "search", body: '{"query":"x"}' });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
