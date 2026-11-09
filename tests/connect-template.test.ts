import { unifiedMcpServer } from "../src/commands/mcp.js";
import { describe, expect, it } from "vitest";
import { resolveTemplate, DEFAULT_TEMPLATE } from "../src/commands/connect.js";
import { renderT2Page } from "../src/commands/connect-t2.js";

const servers = [unifiedMcpServer()];
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
  const html = renderT2Page(servers, clients, "tok", false, true, false, "start");

  it("renders all six steps on the rail and one pane each", () => {
    for (let n = 1; n <= 6; n++) {
      expect(html).toContain(`data-step="${n}"`);
      expect(html).toContain(`data-pane="${n}"`);
    }
  });

  it("offers only the unified Router without category selection or docs MCP", () => {
    expect(html).toContain("https://mcp.aisa.one/mcp");
    expect(html).not.toContain('id="spAll"');
    expect(html).not.toContain('class="ctile"');
    expect(html).not.toContain("aisa-docs");
    expect(html).not.toContain("/web-search/mcp");
  });

  it("offers install for a missing CLI agent and lists file clients as not found", () => {
    expect(html).toContain('data-cid="codex"');
    expect(html).toContain('data-install="1"');
    expect(html).toContain("Cursor <i>not found</i>");
  });

  it("only highlights client cards whose inputs are checked before JavaScript runs", () => {
    const cards = [...html.matchAll(/<label class="tile agent([^"]*)" data-cid="[^"]+">([\s\S]*?)<\/label>/g)];
    expect(cards.length).toBeGreaterThan(1);
    for (const [, classes, body] of cards) {
      expect(classes.split(" ").includes("on")).toBe(/<input[^>]* checked/.test(body));
    }
  });

  it("keeps the default server ticked and embeds the run token", () => {
    expect(html).toMatch(/value="router" checked disabled/);
    expect(html).toContain('var TOKEN = "tok"');
    expect(html).toContain('var VIEW = "start"');
    expect(renderT2Page(servers, clients, "tok", true, true, false, "done")).toContain('var VIEW = "done"');
  });
});
