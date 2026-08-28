import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * VS Code's chat models and MCP servers are plain files; these pin that the
 * writers are key-exact (other groups / servers survive) and idempotent.
 */

let home: string;
vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

const { writeVSCodeLLM, removeVSCodeLLM, writeVSCodeMCP, vscodeUserDir, VSCODE_MODELS } =
  await import("../src/commands/vscode.js");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-vsc-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const server = { slug: "web-search", name: "AIsa Web Search", endpoint: "https://mcp.aisa.one/web-search/mcp", toolCount: 27, description: "", category: "Search" };

describe("VS Code writers", () => {
  it("adds the AIsa model group beside an existing one and replaces only itself on re-run", () => {
    const dir = vscodeUserDir();
    mkdirSync(dir, { recursive: true });
    const theirs = { vendor: "openai", name: "Mine", apiKey: "x", models: [] };
    writeFileSync(join(dir, "chatLanguageModels.json"), JSON.stringify([theirs]));
    expect(writeVSCodeLLM("k1").ok).toBe(true);
    expect(writeVSCodeLLM("k2").ok).toBe(true);
    const groups = JSON.parse(readFileSync(join(dir, "chatLanguageModels.json"), "utf-8"));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(theirs);
    expect(groups[1].vendor).toBe("customendpoint");
    expect(groups[1].apiKey).toBe("k2");
    expect(groups[1].models).toHaveLength(VSCODE_MODELS.length);
    expect(groups[1].models[0].url).toBe("https://api.aisa.one/v1");
    expect(removeVSCodeLLM().ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "chatLanguageModels.json"), "utf-8"))).toEqual([theirs]);
  });

  it("writes http MCP entries with the bearer, keeping other servers", () => {
    const dir = vscodeUserDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: { other: { type: "stdio", command: "x" } }, inputs: [] }));
    const r = writeVSCodeMCP([server], "key");
    expect(r.ok).toBe(true);
    const doc = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf-8"));
    expect(doc.inputs).toEqual([]);
    expect(doc.servers.other.command).toBe("x");
    expect(doc.servers["aisa-web-search"]).toEqual({
      type: "http", url: server.endpoint, headers: { Authorization: "Bearer key" },
    });
    expect(writeVSCodeMCP([server], undefined).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "mcp.json"), "utf-8")).servers["aisa-web-search"]).toEqual({ type: "http", url: server.endpoint });
  });

  it("refuses a file it cannot parse", () => {
    const dir = vscodeUserDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.json"), "{ not json");
    expect(writeVSCodeMCP([server], "k").ok).toBe(false);
  });
});
