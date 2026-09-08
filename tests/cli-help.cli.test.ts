/**
 * Compiled public-contract checks for help / manifest / example JSON.
 * Parses the JSON examples; does not snapshot help essays.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MCP_CLI_MAP } from "../src/cli-guidance.js";
import { validateEnvelope } from "../src/commands/tool-input.js";
import {
  EXAMPLE_BATCH,
  EXAMPLE_BATCH_JSON,
  EXAMPLE_PUBLISHED_TOOL,
  EXAMPLE_SCHEMA,
  EXAMPLE_SCHEMA_JSON,
  EXAMPLE_SEARCH,
  EXAMPLE_SEARCH_JSON,
  EXAMPLE_SEARCH_LIMIT_JSON,
  EXAMPLE_SEARCH_QUOTED,
  EXAMPLE_SEARCH_QUOTED_JSON,
} from "../src/commands/tool-help.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "index.js");

beforeAll(() => {
  if (!existsSync(cli)) {
    execFileSync("npx", ["tsc"], { cwd: root, stdio: "pipe" });
  }
});

describe("help example JSON is complete and valid", () => {
  it("shared --input examples parse as Router envelopes", () => {
    expect(EXAMPLE_SEARCH_JSON.includes("...")).toBe(false);
    expect(EXAMPLE_SCHEMA_JSON.includes("...")).toBe(false);
    expect(EXAMPLE_BATCH_JSON.includes("...")).toBe(false);
    validateEnvelope("search", EXAMPLE_SEARCH);
    validateEnvelope("search", EXAMPLE_SEARCH_QUOTED);
    expect(EXAMPLE_SEARCH_QUOTED_JSON).toContain("O'Reilly");
    expect(EXAMPLE_SEARCH_QUOTED_JSON).toContain("苹果");
    validateEnvelope("schema", EXAMPLE_SCHEMA);
    validateEnvelope("quote", EXAMPLE_BATCH);
    validateEnvelope("call", EXAMPLE_BATCH);
    expect(EXAMPLE_BATCH.calls[0]?.tool).toBe(EXAMPLE_PUBLISHED_TOOL);
    expect(EXAMPLE_BATCH.calls[0]?.arguments).toEqual({ ticker: "AAPL" });
  });
});

describe("compiled --help and manifest", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  function isolatedHome(): string {
    const home = mkdtempSync(join(tmpdir(), "aisa-cli-help-"));
    homes.push(home);
    return home;
  }

  it("root and four command help expose complete JSON, mapping, auth, exits, and file/stdin", async () => {
    const home = isolatedHome();
    const pages: Record<string, string> = {};
    for (const args of [[], ["search"], ["schema"], ["quote"], ["call"]]) {
      const ran = await runCompiledCli([...args, "--help"], { HOME: home });
      expect(ran.status, args.join(" ") || "root").toBe(0);
      pages[args[0] ?? "root"] = ran.stdout;
    }

    for (const [name, text] of Object.entries(pages)) {
      expect(text, name).not.toMatch(/similarweb_get_company/);
      expect(text, name).not.toMatch(/--input '[^']*\.\.\.[^']*'/);
      expect(text, name).not.toMatch(/Unquoted calls cannot be executed/);
      expect(text, name).toContain("AISA_API_KEY");
      expect(text, name).toContain("~/.aisa/key");
      expect(text, name).toMatch(/Enforced:/);
      expect(text, name).toMatch(/Exits: 0 success/);
      expect(text, name).toMatch(/POSIX sh/);
    }

    expect(pages.root).toContain(EXAMPLE_BATCH_JSON);
    expect(pages.root).toContain(EXAMPLE_PUBLISHED_TOOL);
    expect(pages.root).toMatch(/not drop-in/);
    expect(pages.root).toMatch(/api list[\s\S]*unchanged/);

    expect(pages.search).toContain(EXAMPLE_SEARCH_JSON);
    expect(pages.search).toContain(EXAMPLE_SEARCH_LIMIT_JSON);
    expect(pages.search).toContain("O'\\''Reilly");
    expect(pages.search).toContain("苹果");
    expect(pages.search).toMatch(/no file required/i);
    expect(pages.search).toContain("-f request.json");
    expect(pages.search).toContain("-f -");
    expect(pages.search).toContain(MCP_CLI_MAP.search.identifier);
    expect(pages.search).toMatch(/Do not guess required unresolved values/);

    expect(pages.schema).toContain(EXAMPLE_SCHEMA_JSON);
    expect(pages.schema).toContain(EXAMPLE_PUBLISHED_TOOL);
    expect(pages.schema).toContain(MCP_CLI_MAP.schema.identifier);

    for (const name of ["quote", "call"] as const) {
      expect(pages[name]).toContain(EXAMPLE_BATCH_JSON);
      expect(pages[name]).toMatch(/same request shape/i);
      expect(pages[name]).toContain("not spending approval");
      expect(pages[name]).toContain("never free");
      expect(pages[name]).toContain(MCP_CLI_MAP[name].identifier);
    }
    expect(pages.quote).toMatch(/no guaranteed maximum/);
    expect(pages.quote).toMatch(/partial quote is not a full-batch total/i);
    expect(pages.call).toMatch(/Do not silently retry/);
    expect(pages.root).toMatch(/do not invent a business result/i);
    expect(pages.root).toMatch(/Do not execute unquoted calls/);
    expect(pages.quote).toMatch(/Do not execute unquoted calls/);
    expect(pages.call).toMatch(/does not reject an unquoted aisa call/);

    const extracted = extractInputObjects(`${pages.root}\n${pages.search}\n${pages.schema}\n${pages.quote}\n${pages.call}`);
    expect(extracted.length).toBeGreaterThan(3);
    for (const value of extracted) {
      expect(JSON.stringify(value).includes("...")).toBe(false);
    }
  });

  it("manifest documents MCP mapping and only the three legacy deprecations", async () => {
    const home = isolatedHome();
    const rootManifest = await runCompiledCli(["manifest"], { HOME: home });
    expect(rootManifest.status).toBe(0);
    const tree = JSON.parse(rootManifest.stdout) as ManifestNode;

    for (const name of ["search", "schema", "quote", "call"] as const) {
      const scoped = await runCompiledCli(["manifest", name], { HOME: home });
      expect(scoped.status).toBe(0);
      const node = JSON.parse(scoped.stdout) as ManifestNode;
      expect(node.mcp?.identifier).toBe(MCP_CLI_MAP[name].identifier);
      expect(node.mcp?.path).toBe(MCP_CLI_MAP[name].path);
      expect(node.auth).toBe(name === "quote" || name === "call" ? "required" : "optional");
      expect(node.enforced?.some((line) => line.startsWith("Enforced:"))).toBe(true);
      expect(node.enforced?.join("\n")).not.toMatch(/Unquoted calls cannot be executed/);
      expect(node.safety?.length).toBeGreaterThan(0);
      expect(node.exits?.["2"]).toMatch(/nothing sent/);
      expect(node.deprecated).toBeUndefined();
      expect(find(tree, `aisa ${name}`)?.mcp?.identifier).toBe(MCP_CLI_MAP[name].identifier);
      for (const ex of node.examples ?? []) {
        expect(ex.argv[0]).toBe(name);
        expect(ex.argv).toContain("--input");
        expect(ex.argv).toContain("--json");
        expect(JSON.stringify(ex.input ?? {}).includes("...")).toBe(false);
        if (ex.input) {
          validateEnvelope(name, ex.input);
        }
      }
    }

    expect(tree.router?.legacy.deprecated).toEqual(["api search", "api show", "run"]);
    expect(tree.router?.safety.join("\n")).toMatch(/not spending approval/);
    const searchNode = JSON.parse((await runCompiledCli(["manifest", "search"], { HOME: home })).stdout) as ManifestNode;
    const quoted = searchNode.examples?.find((ex) => JSON.stringify(ex.input).includes("O'Reilly"));
    expect(quoted?.input).toEqual(EXAMPLE_SEARCH_QUOTED);

    expect(find(tree, "aisa api list")?.deprecated).toBeUndefined();
    expect(find(tree, "aisa api code")?.deprecated).toBeUndefined();
    expect(find(tree, "aisa api search")?.deprecated).toBe(true);
    expect(find(tree, "aisa api show")?.deprecated).toBe(true);
    expect(find(tree, "aisa run")?.deprecated).toBe(true);
    expect(find(tree, "aisa api search")?.migration).toMatch(/Not a drop-in/);
    expect(find(tree, "aisa run")?.migration).toMatch(/Not a drop-in/);
  });

  it("does not attach Router MCP metadata to nested search commands", async () => {
    const home = isolatedHome();
    const rootSearch = JSON.parse((await runCompiledCli(["manifest", "search"], { HOME: home })).stdout) as ManifestNode;
    expect(rootSearch.path).toBe("aisa search");
    expect(rootSearch.mcp?.identifier).toBe(MCP_CLI_MAP.search.identifier);
    expect(rootSearch.auth).toBe("optional");
    expect(rootSearch.exits?.["0"]).toBeDefined();
    expect(rootSearch.examples?.length).toBeGreaterThan(0);

    for (const args of [["api", "search"], ["twitter", "search"], ["skills", "search"]]) {
      const nested = JSON.parse((await runCompiledCli(["manifest", ...args], { HOME: home })).stdout) as ManifestNode;
      expect(nested.path, args.join(" ")).toBe(`aisa ${args.join(" ")}`);
      expect(nested.mcp, args.join(" ")).toBeUndefined();
      expect(nested.auth, args.join(" ")).toBeUndefined();
      expect(nested.exits, args.join(" ")).toBeUndefined();
      expect(nested.examples, args.join(" ")).toBeUndefined();
      expect(nested.enforced, args.join(" ")).toBeUndefined();
      expect(nested.flow, args.join(" ")).toBeUndefined();
      expect(nested.safety, args.join(" ")).toBeUndefined();
    }

    const apiSearch = JSON.parse((await runCompiledCli(["manifest", "api", "search"], { HOME: home })).stdout) as ManifestNode;
    expect(apiSearch.deprecated).toBe(true);
    expect(apiSearch.mcp).toBeUndefined();
  });

  it("accepts inline --input with apostrophe and Unicode without requiring a file", async () => {
    const home = isolatedHome();
    const ran = await runCompiledCli(
      ["search", "--input", EXAMPLE_SEARCH_QUOTED_JSON, "--json"],
      { HOME: home, AISA_ROUTER_BASE_URL: "http://127.0.0.1:1" }
    );
    expect(ran.status).not.toBe(2);
    expect(`${ran.stdout}\n${ran.stderr}`).not.toMatch(/Invalid JSON/);
    expect(ran.status).toBe(1);
  });
});

interface ManifestNode {
  path: string;
  deprecated?: boolean;
  migration?: string;
  mcp?: { identifier: string; path: string };
  auth?: "optional" | "required";
  enforced?: string[];
  safety?: string[];
  exits?: Record<string, string>;
  examples?: Array<{ argv: string[]; input?: Record<string, unknown> }>;
  router?: { legacy: { deprecated: string[] }; safety: string[] };
  subcommands?: ManifestNode[];
}

function find(node: ManifestNode, path: string): ManifestNode | undefined {
  if (node.path === path) return node;
  for (const child of node.subcommands ?? []) {
    const hit = find(child, path);
    if (hit) return hit;
  }
  return undefined;
}

function extractInputObjects(help: string): unknown[] {
  const out: unknown[] = [];
  let idx = 0;
  while ((idx = help.indexOf("--input ", idx)) !== -1) {
    const start = idx + "--input ".length;
    if (help[start] !== "'") {
      idx = start;
      continue;
    }
    try {
      const { value, next } = decodePosixSingleQuoted(help, start);
      out.push(JSON.parse(value));
      idx = next;
    } catch {
      idx = start + 1;
    }
  }
  return out;
}

function decodePosixSingleQuoted(src: string, from: number): { value: string; next: number } {
  if (src[from] !== "'") throw new Error("expected '");
  let i = from + 1;
  let out = "";
  while (i < src.length) {
    if (src[i] !== "'") {
      out += src[i++];
      continue;
    }
    if (src.startsWith("'\\''", i)) {
      out += "'";
      i += 4;
      continue;
    }
    return { value: out, next: i + 1 };
  }
  throw new Error("unterminated");
}

function runCompiledCli(
  args: string[],
  extraEnv: NodeJS.ProcessEnv
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}
