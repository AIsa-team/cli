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
      expect(text, name).toContain("AISA_API_KEY");
      expect(text, name).toMatch(/Exits: 0 success/);
    }

    expect(pages.root).toContain(EXAMPLE_BATCH_JSON);
    expect(pages.root).toContain(EXAMPLE_PUBLISHED_TOOL);
    expect(pages.root).toMatch(/not drop-in/);
    expect(pages.root).toMatch(/api list[\s\S]*unchanged/);

    expect(pages.search).toContain(EXAMPLE_SEARCH_JSON);
    expect(pages.search).toContain(EXAMPLE_SEARCH_LIMIT_JSON);
    expect(pages.search).toContain("-f request.json");
    expect(pages.search).toContain("-f -");
    expect(pages.search).toContain(MCP_CLI_MAP.search.identifier);

    expect(pages.schema).toContain(EXAMPLE_SCHEMA_JSON);
    expect(pages.schema).toContain(EXAMPLE_PUBLISHED_TOOL);
    expect(pages.schema).toContain(MCP_CLI_MAP.schema.identifier);

    for (const name of ["quote", "call"] as const) {
      expect(pages[name]).toContain(EXAMPLE_BATCH_JSON);
      expect(pages[name]).toMatch(/same request shape/i);
      expect(pages[name]).toContain("not spending approval");
      expect(pages[name]).toContain(MCP_CLI_MAP[name].identifier);
    }

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
      expect(node.deprecated).toBeUndefined();
      expect(find(tree, `aisa ${name}`)?.mcp?.identifier).toBe(MCP_CLI_MAP[name].identifier);
    }

    expect(find(tree, "aisa api list")?.deprecated).toBeUndefined();
    expect(find(tree, "aisa api code")?.deprecated).toBeUndefined();
    expect(find(tree, "aisa api search")?.deprecated).toBe(true);
    expect(find(tree, "aisa api show")?.deprecated).toBe(true);
    expect(find(tree, "aisa run")?.deprecated).toBe(true);
    expect(find(tree, "aisa api search")?.migration).toMatch(/Not a drop-in/);
    expect(find(tree, "aisa run")?.migration).toMatch(/Not a drop-in/);
  });
});

interface ManifestNode {
  path: string;
  deprecated?: boolean;
  migration?: string;
  mcp?: { identifier: string; path: string };
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
  const re = /--input '(\{.*?\})'/g;
  for (const match of help.matchAll(re)) {
    out.push(JSON.parse(match[1] as string));
  }
  return out;
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
