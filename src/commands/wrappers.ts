import { execFileSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LLM_BASE_URL } from "../constants.js";
import type { ModelChoice } from "./llm-config.js";

/**
 * The claude-aisa / codex-aisa companion commands: run the agent the user
 * already has, on AIsa, without touching a byte of their own configuration.
 *
 * Verified mechanics (2026-08-22, three loopback experiments):
 *  - Claude Code's settings.json env OVERRIDES real environment variables,
 *    so an env-prefix wrapper cannot work — but `--settings <file>` overrides
 *    everything, and it is the same flag Sapiom runs its whole product on.
 *    claude-aisa therefore points --settings at a file under ~/.aisa.
 *  - Codex has native profiles: codex-aisa is just `--profile aisa`, whose
 *    definition lives in ~/.codex/config.toml (profiles cannot be external).
 *
 * The wrappers contain no credentials. Claude's key sits in the settings
 * file (same directory and permissions as the key itself); Codex's sits in
 * its provider entry. Removing a wrapper is deleting one small file.
 */

const aisaDir = () => join(homedir(), ".aisa");
export const CLAUDE_AISA_SETTINGS = () => join(aisaDir(), "claude-aisa.settings.json");

/** The --settings document claude-aisa loads: gateway env + model tiers. */
export function writeClaudeAisaSettings(apiKey: string, models: ModelChoice): string {
  mkdirSync(aisaDir(), { recursive: true });
  const path = CLAUDE_AISA_SETTINGS();
  const doc = {
    env: {
      ANTHROPIC_BASE_URL: LLM_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: models.smallModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: models.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: models.model,
    },
  };
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/**
 * Where wrappers go: npm's global bin first — on this platform it is the
 * directory the agents themselves live in, so it is on PATH by definition.
 * ~/.local/bin is the fallback (standard on Linux, needs one PATH line on
 * macOS — reported to the caller, never written into anyone's shell rc).
 */
export function wrapperBinDir(): { dir: string; onPath: boolean } {
  let dir: string | undefined;
  try {
    const prefix = execFileSync("npm", ["config", "get", "prefix"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    if (prefix && existsSync(join(prefix, "bin"))) {
      accessSync(join(prefix, "bin"), constants.W_OK);
      dir = join(prefix, "bin");
    }
  } catch {
    /* fall through to ~/.local/bin */
  }
  if (!dir) {
    dir = join(homedir(), ".local", "bin");
    mkdirSync(dir, { recursive: true });
  }
  const onPath = (process.env.PATH ?? "").split(":").includes(dir);
  return { dir, onPath };
}

export type WrapperResult = {
  ok: boolean;
  dir: string;
  wrote: string[];
  /** Set when the chosen dir is not on PATH — the one line the user can add. */
  pathHint?: string;
};

/** Write one or both wrappers, idempotently. */
export function installWrappers(which: Array<"claude-aisa" | "codex-aisa">): WrapperResult {
  const { dir, onPath } = wrapperBinDir();
  const scripts: Record<string, string> = {
    "claude-aisa": `#!/bin/sh
# AIsa companion for Claude Code. Your own claude setup is untouched:
# this one session loads AIsa's settings via --settings and nothing else.
exec claude --settings "$HOME/.aisa/claude-aisa.settings.json" "$@"
`,
    "codex-aisa": `#!/bin/sh
# AIsa companion for Codex: your default setup stays as it is; this runs
# the aisa profile defined in ~/.codex/config.toml for this session only.
exec codex --profile aisa "$@"
`,
  };
  const wrote: string[] = [];
  try {
    for (const name of which) {
      const p = join(dir, name);
      writeFileSync(p, scripts[name], { mode: 0o755 });
      chmodSync(p, 0o755);
      wrote.push(name);
    }
  } catch {
    return { ok: false, dir, wrote };
  }
  return {
    ok: true,
    dir,
    wrote,
    ...(onPath
      ? {}
      : { pathHint: `echo 'export PATH="${dir}:$PATH"' >> ~/.zshrc && source ~/.zshrc` }),
  };
}
