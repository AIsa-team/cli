import { describe, expect, it } from "vitest";
import { resolveTemplate, DEFAULT_TEMPLATE } from "../src/commands/connect.js";
import { renderT2Page } from "../src/commands/connect-t2.js";

const servers = [
  { slug: "web-search", name: "AIsa Web Search", endpoint: "https://mcp.aisa.one/web-search/mcp", toolCount: 27, description: "Search the web.", category: "Search & Research" },
  { slug: "youtube-search", name: "AIsa YouTube Search", endpoint: "https://mcp.aisa.one/youtube-search/mcp", toolCount: 1, description: "Search YouTube.", category: "Search" },
  { slug: "marketpulse", name: "AIsa MarketPulse", endpoint: "https://mcp.aisa.one/marketpulse/mcp", toolCount: 21, description: "US equities.", category: "Finance" },
];
const clients = [
  { id: "claude-code", label: "Claude Code", kind: "cli" as const, detected: true, detail: "2.1.241" },
  { id: "codex", label: "Codex", kind: "cli" as const, detected: false, detail: "codex not found on PATH" },
  { id: "cursor", label: "Cursor", kind: "file" as const, detected: false, detail: "~/.cursor/mcp.json" },
];

describe("connect template selection", () => {
  it("defaults to T2 and honours the flag over the environment", () => {
    const saved = process.env.AISA_CONNECT_TEMPLATE;
    delete process.env.AISA_CONNECT_TEMPLATE;
    expect(resolveTemplate(undefined)).toBe(DEFAULT_TEMPLATE);
    expect(resolveTemplate("t1")).toBe("t1");
    process.env.AISA_CONNECT_TEMPLATE = "t1";
    expect(resolveTemplate(undefined)).toBe("t1");
    expect(resolveTemplate("T2")).toBe("t2");
    expect(resolveTemplate("bogus")).toBe(DEFAULT_TEMPLATE);
    if (saved === undefined) delete process.env.AISA_CONNECT_TEMPLATE; else process.env.AISA_CONNECT_TEMPLATE = saved;
  });
});

describe("T2 page", () => {
  const html = renderT2Page(servers, clients, "tok", false, true, "start");

  it("renders all six steps on the rail and one pane each", () => {
    for (let n = 1; n <= 6; n++) {
      expect(html).toContain(`data-step="${n}"`);
      expect(html).toContain(`data-pane="${n}"`);
    }
  });

  it("merges the two search categories and puts Search first", () => {
    expect(html).not.toMatch(/data-cat="Search"/);
    expect(html.indexOf('data-cat="Search & Research"')).toBeLessThan(html.indexOf('data-cat="Finance"'));
    expect(html).toContain("2 servers · 28 tools");
  });

  it("offers install for a missing CLI agent and lists file clients as not found", () => {
    expect(html).toContain('data-cid="codex"');
    expect(html).toContain('data-install="1"');
    expect(html).toContain("Cursor <i>not found</i>");
  });

  it("keeps the default server ticked and embeds the run token", () => {
    expect(html).toMatch(/value="web-search" checked/);
    expect(html).toContain('var TOKEN = "tok"');
    expect(html).toContain('var VIEW = "start"');
    expect(renderT2Page(servers, clients, "tok", true, true, "done")).toContain('var VIEW = "done"');
  });
});
