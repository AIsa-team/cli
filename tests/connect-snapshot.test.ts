import { describe, expect, it } from "vitest";
import { renderT2Page } from "../src/commands/connect-t2.js";
import type { LiveServer } from "../src/commands/mcp.js";
import type { ClientInfo } from "../src/commands/connect-shared.js";

/**
 * A gate for moving the page's copy into a shared flow definition.
 *
 * The T2 template is 82% template strings, and every user-facing sentence
 * lives inside one — which is why the terminal has its own hand-copied
 * paraphrase of the same choices, and why the two drift. Extracting that copy
 * so both render from one source is a large refactor of markup nobody wants to
 * re-review line by line.
 *
 * So the refactor gets an objective gate instead of an eyeball: whatever moves,
 * the rendered page must not change. These snapshots are that gate. They are
 * deliberately whole-page and byte-exact — a looser check would let exactly the
 * kind of quiet wording change through that the whole exercise is meant to
 * prevent.
 *
 * When a snapshot fails, there are only two honest responses: the change was
 * unintended and is a bug, or it was intended and the snapshot is updated in
 * the same commit that explains why. "Update snapshots to make CI green" is
 * neither.
 */

const servers: LiveServer[] = [
  { slug: "web-search", name: "AIsa Web Search", endpoint: "https://mcp.aisa.one/web-search/mcp", toolCount: 27, description: "Search the web.", category: "Search & Research" },
  { slug: "agentmail", name: "AIsa AgentMail", endpoint: "https://mcp.aisa.one/agentmail/mcp", toolCount: 49, description: "Email for agents.", category: "Communication" },
  { slug: "marketpulse", name: "AIsa MarketPulse", endpoint: "https://mcp.aisa.one/marketpulse/mcp", toolCount: 21, description: "US equities.", category: "Finance" },
];

/**
 * Every shape the agent step can take at once: a detected CLI, one that is
 * absent but installable, an editor found by its config directory, and a web
 * target that is never installed. Rendering only the happy row would leave the
 * branches that actually differ unguarded.
 */
const clients: ClientInfo[] = [
  { id: "claude-code", label: "Claude Code", kind: "cli", detected: true, detail: "2.1.241" },
  { id: "codex", label: "Codex", kind: "cli", detected: false, detail: "codex not found on PATH", installable: true, command: "npm install -g @openai/codex" },
  { id: "opencode", label: "opencode", kind: "cli", detected: false, detail: "opencode not found on PATH" },
  { id: "vscode", label: "VS Code", kind: "file", detected: true, detail: "~/Library/Application Support/Code/User" },
  { id: "cursor", label: "Cursor", kind: "file", detected: true, detail: "~/.cursor/mcp.json" },
  { id: "claude-desktop", label: "Claude Desktop", kind: "file", detected: false, detail: "not installed" },
];

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("T2 page — byte-exact snapshots", () => {
  it("start view, key already configured", () => {
    expect(renderT2Page(servers, clients, TOKEN, true, true, "start")).toMatchSnapshot();
  });

  it("start view, no key — the sign-in step reads differently", () => {
    expect(renderT2Page(servers, clients, TOKEN, false, true, "start")).toMatchSnapshot();
  });

  it("start view, installers unavailable — the install offer must disappear", () => {
    expect(renderT2Page(servers, clients, TOKEN, true, false, "start")).toMatchSnapshot();
  });

  it("done view", () => {
    expect(renderT2Page(servers, clients, TOKEN, true, true, "done")).toMatchSnapshot();
  });

  it("nothing detected — every card is an install offer", () => {
    const none = clients.map((c) => ({ ...c, detected: false }));
    expect(renderT2Page(servers, none, TOKEN, true, true, "start")).toMatchSnapshot();
  });
});

/**
 * Assertions on the copy itself, so a snapshot update cannot quietly drop a
 * sentence. A snapshot proves "unchanged"; these prove "still present" — and
 * they are what the terminal renderer will have to satisfy too once the same
 * strings come from the flow definition rather than from this markup.
 */
describe("T2 agent step — the copy the terminal will have to match", () => {
  const page = () => renderT2Page(servers, clients, TOKEN, true, true, "start");

  it("asks the question", () => {
    expect(page()).toContain("Which agent should AIsa");
  });

  it("names every agent offered", () => {
    const html = page();
    for (const c of clients) expect(html).toContain(c.label);
  });

  it("marks detected and undetected differently", () => {
    const html = page();
    expect(html).toContain("✓ detected");
    expect(html).toContain("not installed");
  });

  it("shows an installable agent's exact command", () => {
    expect(page()).toContain("npm install -g @openai/codex");
  });

  it("carries a per-agent explanation of what connecting means", () => {
    const html = page();
    expect(html).toContain("claude mcp add");
    expect(html).toContain("codex mcp add");
  });
});

/**
 * The page script is assembled as a string, so `tsc` never parses it: a typo
 * inside it compiles cleanly and breaks only in a browser, where nobody here
 * would see it. This ran for the first time while moving the last inline
 * strings into the flow definition — exactly the edit most likely to leave an
 * unbalanced quote behind.
 */
describe("the generated page script is valid JavaScript", () => {
  const cases = [
    ["en", "start"], ["en", "done"], ["zh", "start"], ["zh", "done"],
  ] as const;

  it.each(cases)("%s / %s", (lang, view) => {
    const html = renderT2Page(servers, clients, TOKEN, true, true, view, lang);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      expect(() => new Function(src), src.slice(0, 120)).not.toThrow();
    }
  });
});
