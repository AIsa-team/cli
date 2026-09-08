import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillsInitAction } from "../src/commands/skills.js";

const REMOVED = [
  /\baisa web-search\b/,
  /\baisa scholar\b/,
  /\baisa stock\b/,
  /\baisa crypto\b/,
  /\baisa screener\b/,
  /\baisa tweet\b/,
  /\baisa twitter\b/,
  /\baisa video\b/,
  /\baisa run\b/,
  /\baisa code\b/,
  /\baisa api search\b/,
  /\baisa api code\b/,
  /\[deprecated\]/i,
];

const ROUTER = ["aisa search", "aisa schema", "aisa quote", "aisa call"];
const TEMPLATES = ["default", "llm", "search", "finance", "twitter", "video"] as const;

let root: string;

function init(name: string, options: { template?: string; bare?: boolean } = {}): string {
  const dir = join(root, name);
  skillsInitAction(dir, options);
  return readFileSync(join(dir, "SKILL.md"), "utf-8");
}

function expectNoRemovedCommands(content: string): void {
  for (const pattern of REMOVED) {
    expect(content, String(pattern)).not.toMatch(pattern);
  }
}

function publishedTools(content: string): string[] {
  return content.match(/\bget_[a-z0-9_]+\b/g) ?? [];
}

describe("skills init templates", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aisa-skill-init-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each(TEMPLATES)("%s writes only retained command invocations", (template) => {
    const content = init(template, { template });
    expectNoRemovedCommands(content);
  });

  it("default and domain templates teach search/schema/quote/call plus catalog browse", () => {
    for (const template of ["default", "search", "finance", "twitter", "video"] as const) {
      const content = init(template, { template });
      for (const cmd of ROUTER) {
        expect(content, `${template} ${cmd}`).toContain(cmd);
      }
      expect(content).toContain("aisa api list");
      expect(content).toContain("aisa api show");
      expect(content).toMatch(/not a substitute for schema/i);
    }
  });

  it("llm template keeps chat/models and does not invent Router tool ids", () => {
    const content = init("llm-assistant", { template: "llm" });
    expect(content).toContain("aisa chat");
    expect(content).toContain("aisa models");
    expect(publishedTools(content)).toEqual([]);
  });

  it("only documents the known published finance tool id", () => {
    const allowed = new Set(["get_financial_company_facts"]);
    for (const template of ["default", "finance"] as const) {
      const tools = publishedTools(init(template, { template }));
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((name) => allowed.has(name))).toBe(true);
    }
    for (const template of ["search", "twitter", "video"] as const) {
      expect(publishedTools(init(template, { template }))).toEqual([]);
    }
  });

  it("bare init uses the default Router workflow without removed commands", () => {
    const content = init("bare-skill", { bare: true });
    expectNoRemovedCommands(content);
    for (const cmd of ROUTER) expect(content).toContain(cmd);
    expect(content).toContain("aisa api list");
  });
});
