import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TOML from "smol-toml";

/**
 * Backup mode's whole promise is "nothing you rely on changes". These tests
 * pin that promise: the codex profile writer must not touch the top-level
 * default, the opencode backup must not touch `model`, and the claude
 * settings file must carry the key at 0600.
 */

let home: string;

vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

const { writeClaudeAisaSettings, installWrappers } = await import("../src/commands/wrappers.js");
const { writeCodexAisaProfile, writeOpencodeAisaBackup, DEFAULT_MODELS, CODEX_DEFAULT_MODELS } =
  await import("../src/commands/llm-config.js");
const { LLM_BASE_URL, AISA_PROVIDER_ID } = await import("../src/constants.js");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-wrap-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("claude-aisa settings file", () => {
  it("writes the gateway env at 0600 under ~/.aisa", () => {
    const p = writeClaudeAisaSettings("sk-test", DEFAULT_MODELS);
    expect(p).toBe(join(home, ".aisa", "claude-aisa.settings.json"));
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const doc = JSON.parse(readFileSync(p, "utf-8"));
    expect(doc.env.ANTHROPIC_BASE_URL).toBe(LLM_BASE_URL);
    expect(doc.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-test");
    expect(doc.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(DEFAULT_MODELS.model);
  });
});

describe("codex backup profile", () => {
  it("adds provider and [profiles.aisa] without touching the default", () => {
    const cfgPath = join(home, ".codex", "config.toml");
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(cfgPath, TOML.stringify({ model_provider: "openai", model: "gpt-5" }), "utf-8");
    const res = writeCodexAisaProfile("sk-test");
    expect(res.ok).toBe(true);
    const cfg = TOML.parse(readFileSync(cfgPath, "utf-8")) as Record<string, any>;
    expect(cfg.model_provider).toBe("openai");
    expect(cfg.model).toBe("gpt-5");
    expect(cfg.model_providers[AISA_PROVIDER_ID].experimental_bearer_token).toBe("sk-test");
    expect(cfg.profiles[AISA_PROVIDER_ID]).toEqual({
      model_provider: AISA_PROVIDER_ID,
      model: CODEX_DEFAULT_MODELS.model,
    });
  });
});

describe("opencode backup", () => {
  it("adds the provider without touching model/small_model", () => {
    const cfgPath = join(home, ".config", "opencode", "opencode.json");
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ model: "anthropic/claude-2" }), "utf-8");
    const res = writeOpencodeAisaBackup("sk-test");
    expect(res.ok).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    expect(cfg.model).toBe("anthropic/claude-2");
    expect(cfg.small_model).toBeUndefined();
    expect(cfg.provider[AISA_PROVIDER_ID].options.apiKey).toBe("sk-test");
  });
});

describe("installWrappers", () => {
  it("writes executable scripts that carry no credentials", () => {
    // Force the ~/.local/bin fallback by making npm unavailable via PATH.
    const oldPath = process.env.PATH;
    process.env.PATH = "/nonexistent";
    const res = installWrappers(["claude-aisa", "codex-aisa"]);
    process.env.PATH = oldPath;
    expect(res.ok).toBe(true);
    expect(res.dir).toBe(join(home, ".local", "bin"));
    for (const name of ["claude-aisa", "codex-aisa"]) {
      const p = join(res.dir, name);
      expect(statSync(p).mode & 0o111).toBeTruthy();
      const body = readFileSync(p, "utf-8");
      expect(body).not.toContain("sk-");
      expect(body).toContain(name === "claude-aisa" ? "--settings" : "--profile aisa");
    }
    expect(res.pathHint).toContain(".local/bin");
  });
});
