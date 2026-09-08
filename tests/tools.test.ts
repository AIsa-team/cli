import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/cli-error.js";
import { ROUTER_URL_ENV } from "../src/router.js";

vi.mock("../src/config.js", async (orig) => {
  const actual = await orig<typeof import("../src/config.js")>();
  return {
    ...actual,
    getApiKey: () => process.env.AISA_API_KEY,
    requireApiKey: () => {
      const key = process.env.AISA_API_KEY;
      if (!key) throw new CliError("No API key found", 1);
      return key;
    },
  };
});

const { batchHasFailure, callAction, quoteAction, schemaAction, searchAction } = await import(
  "../src/commands/tools.js"
);

const BIG = "9007199254740993";

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("tool router commands", () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    process.env[ROUTER_URL_ENV] = "http://router.test";
    process.env.AISA_API_KEY = "sk-test";
    process.exitCode = 0;
    stdout = [];
    stderr = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      stdout.push(String(line ?? ""));
    });
    vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      stderr.push(String(line ?? ""));
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    });
  });

  afterEach(() => {
    delete process.env[ROUTER_URL_ENV];
    delete process.env.AISA_API_KEY;
    process.exitCode = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("search posts the query and prints unmodified JSON including big integers", async () => {
    const body = `{"search_id":"s1","tools":[],"next_steps_guidance":[],"n":${BIG}}`;
    const fetchMock = stubFetch(() => new Response(body, { status: 200 }));

    await searchAction("company facts", { json: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://router.test/v1/tool-router/aisa-search-tool");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ query: "company facts" }));
    expect(stdout.join("")).toContain(BIG);
    expect(stdout.join("")).toContain(body);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("search and schema stay anonymous when no key is set", async () => {
    delete process.env.AISA_API_KEY;
    const fetchMock = stubFetch(() => new Response('{"tools":[],"next_steps_guidance":[]}', { status: 200 }));
    await searchAction("q", { json: true });
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("schema posts tools and exits 3 when a returned item failed", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          total_count: 1,
          success_count: 0,
          error_count: 1,
          tools: { missing: { successful: false, error: { code: "not_found", message: "gone" } } },
          next_steps_guidance: ["try search"],
        }),
        { status: 200 }
      )
    );

    await schemaAction(["missing"], { json: true });
    expect(process.exitCode).toBe(3);
  });

  it("quote posts to batch-quote, never batch-use, and keeps the raw micros token", async () => {
    const body = `{"batch_id":"b","total_count":1,"success_count":1,"error_count":0,"results":[{"call_id":"c1","tool":"t","successful":true,"request_id":"r","data":{"object":"cost_estimate","estimate_kind":"estimate","estimated_cost_micros_usd":${BIG},"may_exceed_estimate":true}}],"next_steps_guidance":[]}`;
    const fetchMock = stubFetch(() => new Response(body, { status: 200 }));
    const req = '{"calls":[{"call_id":"c1","tool":"t","arguments":{}}]}';

    await quoteAction({ input: req, json: true });

    expect(String(fetchMock.mock.calls[0][0])).toBe("http://router.test/v1/tool-router/aisa-batch-quote");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("aisa-batch-use");
    expect(fetchMock.mock.calls[0][1]?.body).toBe(req);
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(stdout.join("")).toContain(BIG);
  });

  it("call posts to batch-use once even when the server returns 503", async () => {
    const fetchMock = stubFetch(() => new Response('{"error":{"code":"service_unavailable","message":"down"}}', { status: 503 }));
    const req = '{"calls":[{"call_id":"c1","tool":"t","arguments":{}}]}';

    await expect(callAction({ input: req, json: true })).rejects.toMatchObject({ exitCode: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://router.test/v1/tool-router/aisa-batch-use");
    expect(stdout.join("")).toContain("service_unavailable");
  });

  it("quote and call without a key do not dispatch and do not imply success", async () => {
    delete process.env.AISA_API_KEY;
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    const req = '{"calls":[{"call_id":"c1","tool":"t","arguments":{}}]}';

    await expect(quoteAction({ input: req, json: true })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(
        /No API key found[\s\S]*aisa login --key[\s\S]*AISA_API_KEY[\s\S]*Do not invent a business result/
      ),
    });
    await expect(callAction({ input: req, json: true })).rejects.toMatchObject({ exitCode: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stdout.join("")).not.toMatch(/successful|company_facts|ticker/);
  });

  it("does not dispatch on malformed local input", async () => {
    const fetchMock = stubFetch(() => new Response("{}", { status: 200 }));
    await expect(searchAction(undefined, { json: true })).rejects.toMatchObject({ exitCode: 2 });
    await expect(quoteAction({ input: "{", json: true })).rejects.toMatchObject({ exitCode: 2 });
    await expect(
      searchAction(undefined, { input: '{"query":"x","unexpected":true}', json: true })
    ).rejects.toMatchObject({ exitCode: 2 });
    await expect(
      quoteAction({
        input:
          '{"calls":[{"call_id":"same","tool":"a","arguments":{}},{"call_id":"same","tool":"b","arguments":{}}]}',
        json: true,
      })
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prints each quote result's own micros token, including values above 2^53", async () => {
    const body = `{"batch_id":"b","total_count":2,"success_count":2,"error_count":0,"results":[{"call_id":"cheap","tool":"a","successful":true,"request_id":"r1","data":{"object":"cost_estimate","estimate_kind":"exact","estimated_cost_micros_usd":7,"may_exceed_estimate":false}},{"call_id":"expensive","tool":"b","successful":true,"request_id":"r2","data":{"object":"cost_estimate","estimate_kind":"estimate","estimated_cost_micros_usd":${BIG},"may_exceed_estimate":true}}],"next_steps_guidance":[]}`;
    stubFetch(() => new Response(body, { status: 200 }));
    const req =
      '{"calls":[{"call_id":"cheap","tool":"a","arguments":{}},{"call_id":"expensive","tool":"b","arguments":{}}]}';

    await quoteAction({ input: req });

    const text = stdout.join("\n");
    const cheapIdx = text.indexOf("cheap");
    const expensiveIdx = text.indexOf("expensive");
    expect(cheapIdx).toBeGreaterThan(-1);
    expect(expensiveIdx).toBeGreaterThan(cheapIdx);
    expect(text.slice(cheapIdx, expensiveIdx)).toContain("estimated_cost_micros_usd 7");
    expect(text.slice(cheapIdx, expensiveIdx)).not.toContain(BIG);
    expect(text.slice(expensiveIdx)).toContain(`estimated_cost_micros_usd ${BIG}`);
    expect(text.slice(expensiveIdx)).not.toMatch(/estimated_cost_micros_usd 7\b/);
  });

  it("prints each call result's own customer_cost token", async () => {
    const body = `{"batch_id":"b","total_count":2,"success_count":2,"error_count":0,"results":[{"call_id":"first","tool":"a","successful":true,"request_id":"r1","customer_cost_micros_usd":7},{"call_id":"second","tool":"b","successful":true,"request_id":"r2","customer_cost_micros_usd":${BIG}}],"next_steps_guidance":[]}`;
    stubFetch(() => new Response(body, { status: 200 }));
    const req =
      '{"calls":[{"call_id":"first","tool":"a","arguments":{}},{"call_id":"second","tool":"b","arguments":{}}]}';

    await callAction({ input: req });

    const text = stdout.join("\n");
    const firstIdx = text.indexOf("first");
    const secondIdx = text.indexOf("second");
    expect(text.slice(firstIdx, secondIdx)).toContain("customer_cost_micros_usd 7");
    expect(text.slice(secondIdx)).toContain(`customer_cost_micros_usd ${BIG}`);
    expect(text.slice(secondIdx)).not.toMatch(/customer_cost_micros_usd 7\b/);
  });

  it("maps human guidance and plan text to CLI names and leaves --json untouched", async () => {
    const guidance =
      "If has_full_schema=false, call AISA_BATCH_GET_SCHEMA. Then call AISA_BATCH_QUOTE before AISA_BATCH_USE. A data request or credentials alone is not spending approval.";
    const body = JSON.stringify({
      search_id: "s1",
      plan: {
        plan_ref: "company-fundamentals/v1",
        recommended_steps: ["If has_full_schema=false, call AISA_BATCH_GET_SCHEMA before AISA_BATCH_QUOTE."],
        known_pitfalls: ["Do not call AISA_BATCH_USE without covering authorization."],
        primary_tools: ["get_financial_company_facts"],
      },
      tools: [
        {
          tool: "get_financial_company_facts",
          summary: "Docs may mention AISA_BATCH_USE; that is payload text.",
          has_full_schema: true,
        },
      ],
      next_steps_guidance: [guidance],
    });

    stubFetch(() => new Response(body, { status: 200 }));
    await searchAction("company facts", {});
    const human = stdout.join("\n");
    expect(human).toContain("aisa schema");
    expect(human).toContain("aisa quote");
    expect(human).toContain("aisa call");
    expect(human).toContain("A data request or credentials alone is not spending approval");
    expect(human).toContain("has_full_schema=false");
    expect(human).toContain("Docs may mention AISA_BATCH_USE; that is payload text.");
    const projected = human.replace("Docs may mention AISA_BATCH_USE; that is payload text.", "");
    expect(projected).not.toMatch(/AISA_BATCH_GET_SCHEMA|AISA_BATCH_QUOTE|AISA_BATCH_USE/);
    expect(stderr.join("\n")).not.toMatch(/deprecated/);

    stdout.length = 0;
    stubFetch(() => new Response(body, { status: 200 }));
    await searchAction("company facts", { json: true });
    const raw = stdout.join("");
    expect(raw).toBe(body.endsWith("\n") ? body : `${body}\n`);
    expect(raw).toContain("AISA_BATCH_GET_SCHEMA");
    expect(raw).toContain("AISA_BATCH_QUOTE");
    expect(raw).toContain("AISA_BATCH_USE");
    expect(raw).not.toContain("aisa schema");
    expect(raw).not.toContain("Next steps");
  });

  it("renders returned plan guidance without inventing steps", async () => {
    stubFetch(() =>
      new Response(
        JSON.stringify({
          search_id: "s1",
          plan: {
            plan_ref: "research-company/v1",
            recommended_steps: ["get the facts first"],
            known_pitfalls: ["do not invent tickers"],
            primary_tools: ["t1"],
            related_tools: [],
          },
          tools: [],
          next_steps_guidance: ["generic next"],
        }),
        { status: 200 }
      )
    );

    await searchAction("company facts", {});
    const text = stdout.join("\n");
    expect(text).toContain("research-company/v1");
    expect(text).toContain("get the facts first");
    expect(text).toContain("do not invent tickers");
    expect(text).toContain("generic next");
  });

  it("transport failures become exit 1", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(searchAction("q", { json: true })).rejects.toBeInstanceOf(CliError);
    await expect(searchAction("q", { json: true })).rejects.toMatchObject({ exitCode: 1 });
  });
});

describe("batchHasFailure", () => {
  it("treats error_count and unsuccessful items as a partial batch", () => {
    expect(batchHasFailure('{"error_count":1,"results":[]}')).toBe(true);
    expect(batchHasFailure('{"error_count":0,"results":[{"successful":false}]}')).toBe(true);
    expect(batchHasFailure('{"error_count":0,"tools":{"a":{"successful":false}}}')).toBe(true);
    expect(batchHasFailure('{"error_count":0,"results":[{"successful":true}]}')).toBe(false);
  });
});
