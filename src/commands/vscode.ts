import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDir } from "../utils/file.js";
import { LLM_BASE_URL } from "../constants.js";
import type { LiveServer } from "./mcp.js";
import type { ConfigResult } from "./llm-config.js";

/**
 * VS Code: both of its AI surfaces are plain files in the user profile
 * directory, so both can be written without the UI.
 *
 * - Models: `chatLanguageModels.json` (VS Code ≥ 1.117, the "Custom
 *   Endpoint" provider). Top level is an array of provider groups; ours is
 *   one group `{vendor: "customendpoint", name: "AIsa", apiType, models}`.
 *   Copilot's own models are untouched — the group sits beside them in the
 *   model picker, so this is always an "add", never a switch. Inline
 *   completions stay on Copilot; the provider only covers chat and agent.
 *
 *   The API key is deliberately NOT written. `apiKey` is a `secret: true`
 *   property: at run time VS Code treats the value as a reference into its
 *   own secret storage (`${input:chat.lm.secret.<id>}`), so a literal key
 *   in the file is never sent (verified on 1.134 — the gateway saw an empty
 *   bearer and answered 401). The key is entered once in VS Code's Manage
 *   Models UI, which stores it; there is no command or URI to do that from
 *   outside, and writing its encrypted store is off the table.
 * - MCP: `mcp.json` in the same directory, `{servers: {name: {type: "http",
 *   url, headers}}}`. With a key the entry carries the bearer; without one
 *   VS Code runs the server's OAuth itself on first use.
 *
 * Both writers are key-exact: the AIsa group / `aisa-*` entries are replaced,
 * anything else in either file is kept byte-for-byte equivalent.
 */

export const VSCODE_GROUP_NAME = "AIsa";

/** A representative spread of what the gateway offers, one per lab. */
export const VSCODE_MODELS: Array<{ id: string; name: string }> = [
  { id: "claude-sonnet-5", name: "Claude Sonnet 5 (AIsa)" },
  { id: "claude-opus-5", name: "Claude Opus 5 (AIsa)" },
  { id: "gpt-5.5", name: "GPT-5.5 (AIsa)" },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (AIsa)" },
  { id: "kimi-k3", name: "Kimi K3 (AIsa)" },
  { id: "glm-5.2", name: "GLM-5.2 (AIsa)" },
  { id: "qwen3.7-max", name: "Qwen3.7 Max (AIsa)" },
];

export function vscodeUserDir(): string {
  const home = homedir();
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Code", "User");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Code", "User");
  return join(home, ".config", "Code", "User");
}

/** Present when VS Code has been run at least once on this machine. */
export function vscodeDetected(): boolean {
  return existsSync(vscodeUserDir());
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeVSCodeLLM(models = VSCODE_MODELS): ConfigResult {
  const dir = vscodeUserDir();
  const path = join(dir, "chatLanguageModels.json");
  let groups: unknown;
  try {
    groups = readJson(path) ?? [];
  } catch {
    return { ok: false, reason: `${path} exists but is not valid JSON` };
  }
  if (!Array.isArray(groups)) return { ok: false, reason: `${path} is not the expected array` };
  const ours = {
    vendor: "customendpoint",
    name: VSCODE_GROUP_NAME,
    apiType: "chat-completions",
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      url: `${LLM_BASE_URL}/v1`,
      toolCalling: true,
      vision: false,
      maxInputTokens: 200_000,
      maxOutputTokens: 32_000,
    })),
  };
  const isOurs = (g: unknown) =>
    typeof g === "object" && g !== null && (g as { vendor?: string }).vendor === "customendpoint" &&
    (g as { name?: string }).name === VSCODE_GROUP_NAME;
  // A key reference VS Code already stored for our group survives the
  // rewrite — the user should paste it once, not once per run.
  const prior = groups.find(isOurs) as { apiKey?: unknown } | undefined;
  const next = groups.filter((g) => !isOurs(g));
  next.push(typeof prior?.apiKey === "string" && prior.apiKey.startsWith("${input:") ? { ...ours, apiKey: prior.apiKey } : ours);
  ensureDir(dir);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

export function removeVSCodeLLM(): ConfigResult {
  const path = join(vscodeUserDir(), "chatLanguageModels.json");
  const groups = readJson(path);
  if (!Array.isArray(groups)) return { ok: true, path };
  const next = groups.filter(
    (g) => !(typeof g === "object" && g !== null && (g as { name?: string }).name === VSCODE_GROUP_NAME)
  );
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

/** The `code` command: on PATH when the user enabled it, otherwise inside
 *  the app bundle on macOS or the usual Linux locations. */
export function vscodeBinary(): string | undefined {
  const candidates =
    process.platform === "darwin"
      ? ["code", "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
         join(homedir(), "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")]
      : ["code", "/usr/bin/code", "/usr/share/code/bin/code", "/snap/bin/code"];
  for (const c of candidates) {
    const r = spawnSync(c, ["--version"], { timeout: 15_000, encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return undefined;
}

/** The packaged AIsa extension shipped with the CLI. */
export function vscodeExtensionPath(): string {
  return fileURLToPath(new URL("../../vscode-extension/aisa-vscode.vsix", import.meta.url));
}

/**
 * The fully automatic route for the key: install the AIsa extension, which
 * asks VS Code itself to store the key from ~/.aisa/key and add the model
 * group (see vscode-extension/extension.js). Works on a running VS Code —
 * new extensions activate without a reload.
 */
export function installVSCodeExtension(): { ok: true; bin: string } | { ok: false; reason: string } {
  const bin = vscodeBinary();
  if (!bin) return { ok: false, reason: "the code command was not found" };
  const vsix = vscodeExtensionPath();
  if (!existsSync(vsix)) return { ok: false, reason: `extension package missing at ${vsix}` };
  const r = spawnSync(bin, ["--install-extension", vsix, "--force"], { timeout: 120_000, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, reason: (r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n")[0] };
  return { ok: true, bin };
}

export function writeVSCodeMCP(chosen: LiveServer[], apiKey: string | undefined): ConfigResult & { written?: number } {
  const dir = vscodeUserDir();
  const path = join(dir, "mcp.json");
  let doc: Record<string, unknown>;
  try {
    const raw = readJson(path);
    doc = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return { ok: false, reason: `${path} exists but is not valid JSON` };
  }
  const servers = ((doc.servers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  for (const s of chosen) {
    servers[`aisa-${s.slug}`] = apiKey
      ? { type: "http", url: s.endpoint, headers: { Authorization: `Bearer ${apiKey}` } }
      : { type: "http", url: s.endpoint };
  }
  doc.servers = servers;
  ensureDir(dir);
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n", "utf-8");
  return { ok: true, path, written: chosen.length };
}
