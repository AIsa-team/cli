import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import { prepareRouterRequest, validateEnvelope } from "../src/commands/tool-input.js";

function usage(fn: () => unknown): string {
  try {
    fn();
    throw new Error("expected usage error");
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(2);
    return (err as Error).message;
  }
}

async function usageAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    throw new Error("expected usage error");
  } catch (err) {
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(2);
    return (err as Error).message;
  }
}

describe("prepareRouterRequest", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("builds search from a query operand and optional field flags", async () => {
    const prepared = await prepareRouterRequest("search", ["company facts"], {
      limit: "8",
      provider: ["similarweb"],
    });
    expect(JSON.parse(prepared.body)).toEqual({
      query: "company facts",
      limit: 8,
      provider_filters: ["similarweb"],
    });
  });

  it("builds schema from tool operands without inventing include flags", async () => {
    const prepared = await prepareRouterRequest("schema", ["tool_a", "tool_b"], {});
    expect(JSON.parse(prepared.body)).toEqual({ tools: ["tool_a", "tool_b"] });
  });

  it("sends the original --input text so numeric tokens are not rewritten", async () => {
    const raw = '{"calls":[{"call_id":"c1","tool":"t","arguments":{"n":9007199254740993}}]}';
    const prepared = await prepareRouterRequest("quote", [], { input: raw });
    expect(prepared.body).toBe(raw);
  });

  it("reads -f - from stdin", async () => {
    const chunks = [Buffer.from('{"query":"from-stdin"}')];
    const stdin = {
      isTTY: false,
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    };
    const original = process.stdin;
    Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
    try {
      const prepared = await prepareRouterRequest("search", [], { file: "-" });
      expect(prepared.body).toContain("from-stdin");
    } finally {
      Object.defineProperty(process, "stdin", { value: original, configurable: true });
    }
  });

  it("reads -f FILE and rejects --input together with -f", async () => {
    dir = mkdtempSync(join(tmpdir(), "aisa-req-"));
    const file = join(dir, "req.json");
    writeFileSync(file, '{"query":"from-file"}');

    const prepared = await prepareRouterRequest("search", [], { file });
    expect(prepared.body).toContain("from-file");

    expect(
      await usageAsync(() => prepareRouterRequest("search", [], { input: '{"query":"x"}', file }))
    ).toMatch(/either --input or -f/);
  });

  it("rejects operands combined with --input or -f", async () => {
    expect(
      await usageAsync(() => prepareRouterRequest("search", ["q"], { input: '{"query":"x"}' }))
    ).toMatch(/positional/);
  });

  it("rejects field flags combined with a full envelope", async () => {
    expect(
      await usageAsync(() => prepareRouterRequest("search", [], { input: '{"query":"x"}', limit: "3" }))
    ).toMatch(/field flags/);
  });

  it("requires --input or -f for quote and call", async () => {
    expect(await usageAsync(() => prepareRouterRequest("quote", [], {}))).toMatch(/requires --input/);
    expect(await usageAsync(() => prepareRouterRequest("call", [], {}))).toMatch(/requires --input/);
  });

  it("rejects invalid JSON and a non-object envelope", async () => {
    expect(await usageAsync(() => prepareRouterRequest("search", [], { input: "{nope" }))).toMatch(/Invalid JSON/);
    expect(await usageAsync(() => prepareRouterRequest("search", [], { input: "[]" }))).toMatch(/JSON object/);
  });
});

describe("validateEnvelope", () => {
  it("rejects a search query that is empty or too long", () => {
    expect(usage(() => validateEnvelope("search", { query: "  " }))).toMatch(/query/);
    expect(usage(() => validateEnvelope("search", { query: "x".repeat(2001) }))).toMatch(/2000/);
  });

  it("rejects schema envelopes with no schema type or duplicate tools", () => {
    expect(
      usage(() =>
        validateEnvelope("schema", {
          tools: ["a"],
          include_arguments_schema: false,
          include_response_schema: false,
        })
      )
    ).toMatch(/At least one/);
    expect(usage(() => validateEnvelope("schema", { tools: ["a", "a"] }))).toMatch(/unique/);
  });

  it("checks call envelope shape without inspecting argument values", () => {
    validateEnvelope("call", {
      search_id: "s1",
      calls: [{ call_id: "c1", tool: "t", arguments: { n: 9007199254740993 } }],
    });
    expect(
      usage(() => validateEnvelope("quote", { calls: [{ call_id: "c1", tool: "t" }] }))
    ).toMatch(/arguments/);
  });
});
