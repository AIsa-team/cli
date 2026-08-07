import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { complete, completionScript, isShell } from "../src/completion.js";
import { cacheScope } from "../src/api.js";

/** A stand-in for the real program, exercising the tree walk without side effects. */
function buildProgram(): Command {
  const program = new Command();
  program.name("aisa");

  const api = program.command("api").description("Discover and inspect APIs");
  api.command("list").description("List available APIs").option("--category <cat>", "Filter");
  api.command("show <api> [path]").description("Show endpoints").option("--all", "Show every endpoint");
  api.command("code <slug> <path>").description("Generate a snippet").option("--lang <language>", "Language", "curl");

  program
    .command("run <slug> <path>")
    .description("Execute an API call")
    .option("-q, --query <params...>", "Query parameters")
    .option("--raw", "Raw JSON output");

  program.command("web-search <query>").description("Search the web").option("--type <type>", "Search type", "tavily");
  const models = program.command("models").description("Browse models");
  models.command("list", { isDefault: true }).description("List models").option("--provider <p>", "Filter");
  models.command("show <id>").description("Show one model");
  program.command("stock <symbol>").description("Look up stock data").option("--field <field>", "Data field");
  const skills = program.command("skills").description("Skills");
  skills.command("show <slug>").description("Show skill details");
  skills.command("list").description("List skills").option("--category <cat>", "Filter");
  program.command("__complete [words...]", { hidden: true });

  return program;
}

let cacheDir: string;
let program: Command;

function values(words: string[]): string[] {
  return complete(program, words).map((c) => c.value);
}

describe("shell completion", () => {
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "aisa-completion-"));
    process.env.AISA_CACHE_DIR = cacheDir;
    program = buildProgram();
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.AISA_CACHE_DIR;
  });

  it("completes top-level commands and hides internal ones", () => {
    const out = values([]);
    expect(out).toContain("api");
    expect(out).toContain("run");
    expect(out).not.toContain("__complete");
  });

  it("completes subcommands and options of the current command", () => {
    expect(values(["api"])).toEqual(expect.arrayContaining(["list", "show", "code", "--help"]));
    expect(values(["api", "list"])).toContain("--category");
  });

  it("completes values for options that take one", () => {
    expect(values(["web-search", "AI", "--type"])).toEqual(
      expect.arrayContaining(["tavily", "youtube", "smart"])
    );
    expect(values(["stock", "AAPL", "--field"])).toContain("insider");
    expect(values(["api", "code", "financial", "/news", "--lang"])).toEqual(
      expect.arrayContaining(["curl", "python", "node", "typescript"])
    );
  });

  it("offers a default subcommand's options at the parent position", () => {
    // `aisa models --provider anthropic` is really `models list --provider …`;
    // commander resolves the default child at runtime, so completion must too.
    const out = values(["models"]);
    expect(out).toContain("--provider");
    expect(out).toEqual(expect.arrayContaining(["list", "show"]));
  });

  it("completes a default subcommand's option values, with or without the subcommand", () => {
    writeModelsCache();
    expect(values(["models", "--provider"])).toEqual(["Anthropic", "OpenAI"]);
    expect(values(["models", "list", "--provider"])).toEqual(["Anthropic", "OpenAI"]);
  });

  it("scopes option values to the command that defines them", () => {
    // `skills list --category` reads the skills cache, not the API categories.
    writeSkillsCache();
    expect(values(["skills", "list", "--category"])).toEqual(["financial", "search-research"]);
  });

  it("completes nothing dynamic when the cache is cold, rather than hanging", () => {
    // A completion that hit the network would block the terminal on every Tab.
    expect(values(["run"])).not.toContain("financial");
    // Static candidates still come through; only the cache-backed ones drop out.
    expect(values(["skills", "show"])).toEqual(["--help"]);
  });

  it("offers run slugs from the cached catalog, using the real URL slug", () => {
    writeCatalogCache();
    const out = values(["run"]);
    // Provider id is `brave-search` but requests go to /apis/v1/brave/...
    expect(out).toContain("brave");
    expect(out).not.toContain("brave-search");
    expect(out).toContain("financial");
  });

  it("offers endpoint paths once a slug is given", () => {
    writeCatalogCache();
    expect(values(["run", "financial"])).toContain("/news");
  });

  it("keys endpoint completion on the parsed positional, not the last word", () => {
    // Options are legal before the path: `run financial --raw <TAB>` and
    // `api code financial --lang curl <TAB>` must still complete endpoints.
    writeCatalogCache();
    expect(values(["run", "financial", "--raw"])).toContain("/news");
    expect(values(["api", "code", "financial", "--lang", "curl"])).toContain("/news");
  });

  it("completes skill leaf names, not canonical slugs", () => {
    writeSkillsCache();
    const out = values(["skills", "show"]);
    expect(out).toContain("marketpulse");
    expect(out).not.toContain("financial/marketpulse");
  });

  it("emits a script for every supported shell", () => {
    for (const shell of ["bash", "zsh", "fish"] as const) {
      expect(isShell(shell)).toBe(true);
      const script = completionScript(shell);
      expect(script).toContain("__complete");
      expect(script.length).toBeGreaterThan(50);
    }
    expect(isShell("powershell")).toBe(false);
  });
});

function writeEnvelope(key: string, data: unknown): void {
  const path = join(cacheDir, key);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ fetchedAt: Date.now(), ttlMs: 3_600_000, data }));
}

function writeCatalogCache(): void {
  // Caches are namespaced by the configured gateway host; fixtures must land
  // under the same scope the completion code reads from.
  writeEnvelope(`catalog/${cacheScope()}/category.json`, {
    apis: [
      { id: "financial", endpoint_count: 28, is_active: true },
      { id: "brave-search", endpoint_count: 11, is_active: true },
    ],
  });
  writeEnvelope(`catalog/${cacheScope()}/financial.json`, {
    api: {
      id: "financial",
      endpoint_count: 28,
      is_active: true,
      endpoint_groups: [
        {
          id: "Zero",
          endpoints: [
            { method: "GET", path: "/apis/v1/financial/news", name: "Get Company News" },
            { method: "GET", path: "/apis/v1/financial/filings", name: "Get SEC Filings" },
          ],
        },
      ],
    },
  });
  writeEnvelope(`catalog/${cacheScope()}/brave-search.json`, {
    api: {
      id: "brave-search",
      endpoint_count: 11,
      is_active: true,
      endpoint_groups: [
        { id: "g", endpoints: [{ method: "GET", path: "/apis/v1/brave/web/search", name: "Web Search" }] },
      ],
    },
  });
}

function writeModelsCache(): void {
  writeEnvelope(`models/${cacheScope()}.json`, [
    { id: "claude-opus-4-6", owned_by: "Anthropic" },
    { id: "claude-sonnet-5", owned_by: "Anthropic" },
    { id: "gpt-4.1-mini", owned_by: "OpenAI" },
  ]);
}

function writeSkillsCache(): void {
  writeEnvelope("skills/tree.json", {
    slugs: ["financial/marketpulse", "search-research/multi-search"],
    blobs: {
      "financial/marketpulse": [{ path: "financial/marketpulse/SKILL.md", sha: "a" }],
      "search-research/multi-search": [{ path: "search-research/multi-search/SKILL.md", sha: "b" }],
    },
  });
}
