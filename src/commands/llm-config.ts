import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as TOML from "smol-toml";
import { expandHome, ensureDir } from "../utils/file.js";
import { LLM_BASE_URL, LLM_RESPONSES_BASE_URL, AISA_PROVIDER_ID } from "../constants.js";

/**
 * Pointing a coding agent's model traffic at AIsa.
 *
 * Both agents support this through their own documented settings — no wrapper,
 * no proxy process, nothing injected at runtime. Claude Code reads an `env`
 * block from settings.json; Codex takes a named provider in config.toml. We
 * write one block each and can remove exactly what we wrote.
 *
 * Everything here is reversible by key, never by rewriting the file: a user's
 * own settings live in the same documents and must survive both directions.
 */

/** Written into every managed block so removal never has to guess. */
const MANAGED_KEYS_CLAUDE = [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
] as const;

export interface ModelChoice {
  /** The workhorse model (Claude Code's sonnet/opus tiers, Codex's default). */
  model: string;
  /** The cheap model Claude Code reaches for on small tasks. */
  smallModel: string;
  /** Context window in tokens. Codex needs it declared; without it the CLI
   *  warns "Model metadata not found" and falls back to defaults that
   *  degrade its behaviour. */
  contextWindow: number;
}

/**
 * Defaults follow the agent, not our preference.
 *
 * Each coding agent is tuned around a model family: its system prompt, tool
 * schemas and patch format were written and evaluated against one. Codex is
 * OpenAI's, and `gpt-5.3-codex` is the model trained for it; Claude Code is
 * Anthropic's. Sending either somewhere else works — the gateway speaks both
 * protocols — but it is not the pairing the agent was built for, and it is
 * not what a user installing that agent expects. Both remain switchable.
 */
export const DEFAULT_MODELS: ModelChoice = {
  model: "claude-sonnet-5",
  smallModel: "claude-haiku-4-5-20251001",
  contextWindow: 200_000,
};

export const CODEX_DEFAULT_MODELS: ModelChoice = {
  model: "gpt-5.3-codex",
  smallModel: "gpt-5.4-mini",
  contextWindow: 400_000,
};

/** The default pairing for one agent. */
export function defaultModelsFor(client: string): ModelChoice {
  return client === "codex" ? CODEX_DEFAULT_MODELS : DEFAULT_MODELS;
}

export type ConfigResult = { ok: true; path: string } | { ok: false; reason: string };

// ── Claude Code ─────────────────────────────────────────────────────────────

const claudeSettingsPath = () => expandHome("~/.claude/settings.json");

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    // A file we cannot parse is a file we do not own: refuse rather than
    // replace someone's hand-edited settings.
    return null;
  }
}

export function writeClaudeCodeLLM(apiKey: string, models: ModelChoice = DEFAULT_MODELS): ConfigResult {
  const path = claudeSettingsPath();
  const settings = readJson(path);
  if (settings === null) return { ok: false, reason: `${path} exists but is not valid JSON` };

  const env = { ...((settings.env as Record<string, unknown>) ?? {}) };
  env.ANTHROPIC_AUTH_TOKEN = apiKey;
  env.ANTHROPIC_BASE_URL = LLM_BASE_URL;
  // Claude Code asks for three tiers by name; map the two it will actually
  // reach for and leave opus pointed at the same workhorse.
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = models.smallModel;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = models.model;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = models.model;
  settings.env = env;

  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

export function removeClaudeCodeLLM(): ConfigResult {
  const path = claudeSettingsPath();
  if (!existsSync(path)) return { ok: true, path };
  const settings = readJson(path);
  if (settings === null) return { ok: false, reason: `${path} is not valid JSON` };

  const env = settings.env as Record<string, unknown> | undefined;
  if (!env) return { ok: true, path };
  for (const key of MANAGED_KEYS_CLAUDE) delete env[key];
  // An env block that only ever held our keys should not linger as `{}`.
  if (Object.keys(env).length === 0) delete settings.env;
  writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

// ── Codex ───────────────────────────────────────────────────────────────────

const codexConfigPath = () => expandHome("~/.codex/config.toml");

function readToml(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  try {
    return TOML.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeToml(path: string, config: Record<string, unknown>): void {
  ensureDir(join(path, ".."));
  writeFileSync(path, TOML.stringify(config) + "\n", "utf-8");
}

/**
 * Codex talks the Responses API, not Chat Completions, so its base URL is the
 * `/v1` root our gateway serves `/v1/responses` from — hence the separate
 * constant and `wire_api = "responses"`.
 */
export function writeCodexLLM(apiKey: string, models: ModelChoice = CODEX_DEFAULT_MODELS): ConfigResult {
  const path = codexConfigPath();
  const config = readToml(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid TOML` };

  // Declare the model before selecting it. Codex looks its metadata up in
  // models.json and, finding nothing, warns and falls back to defaults —
  // observed live against a gateway model on 2026-08-20.
  writeCodexModelCatalog(models);

  const providers = { ...((config.model_providers as Record<string, unknown>) ?? {}) };
  providers[AISA_PROVIDER_ID] = {
    name: "AIsa",
    base_url: LLM_RESPONSES_BASE_URL,
    // Codex's own field name for a bearer credential on a custom provider.
    experimental_bearer_token: apiKey,
    wire_api: "responses",
  };
  config.model_providers = providers;
  config.model_provider = AISA_PROVIDER_ID;
  config.model = models.model;
  config.model_catalog_json = CODEX_MODELS_PATH;

  writeToml(path, config);
  return { ok: true, path };
}

/** `~/.codex/models.json`, as Codex spells it in config. */
const CODEX_MODELS_PATH = "~/.codex/models.json";

/**
 * Declare one model in Codex's catalog, preserving any other entries.
 * Best-effort: a catalog we cannot read is left alone and Codex falls back to
 * its warning, which is noisy but not fatal — that must not cost the user the
 * provider config that does work.
 */
function writeCodexModelCatalog(models: ModelChoice): void {
  const path = expandHome(CODEX_MODELS_PATH);
  let catalog: { models: Array<Record<string, unknown>> } = { models: [] };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8"));
      if (parsed && Array.isArray(parsed.models)) catalog = parsed;
    } catch {
      return;
    }
  }
  const others = catalog.models.filter((m) => m.slug !== models.model);
  catalog.models = [
    ...others,
    {
      slug: models.model,
      display_name: models.model,
      description: `${models.model} through the AIsa gateway`,
      // Required by Codex, and each level is a struct rather than a string:
      // it rejects the catalog outright otherwise (both shapes observed live).
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "low", description: "Light reasoning" },
        { effort: "medium", description: "Balanced reasoning" },
        { effort: "high", description: "Deep reasoning" },
      ],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: 0,
      base_instructions: "",
      supports_reasoning_summaries: true,
      default_reasoning_summary: "none",
      support_verbosity: false,
      apply_patch_tool_type: "freeform",
      // Codex's own output-truncation ceiling in bytes; unrelated to context.
      truncation_policy: { mode: "bytes", limit: 10_000 },
      context_window: models.contextWindow,
      max_context_window: models.contextWindow,
      effective_context_window_percent: 95,
      supports_parallel_tool_calls: true,
      experimental_supported_tools: [],
      input_modalities: ["text"],
    },
  ];
  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(catalog, null, 2) + "\n", "utf-8");
}

export function removeCodexLLM(): ConfigResult {
  const path = codexConfigPath();
  if (!existsSync(path)) return { ok: true, path };
  const config = readToml(path);
  if (config === null) return { ok: false, reason: `${path} is not valid TOML` };

  const providers = config.model_providers as Record<string, unknown> | undefined;
  if (providers) {
    delete providers[AISA_PROVIDER_ID];
    if (Object.keys(providers).length === 0) delete config.model_providers;
  }
  // Only surrender the top-level selection if it is still ours: a user who
  // switched back to another provider keeps their choice.
  if (config.model_provider === AISA_PROVIDER_ID) {
    delete config.model_provider;
    delete config.model;
    delete config.model_catalog_json;
  }
  // models.json is declarative metadata: harmless if left, and removing an
  // entry Codex may share with another provider would be the riskier move.
  writeToml(path, config);
  return { ok: true, path };
}

// ── Codex MCP ───────────────────────────────────────────────────────────────

/**
 * Codex keeps MCP servers in the same config.toml. Note `http_headers`, not
 * `headers` — Codex's field name, and getting it wrong fails silently at the
 * first authenticated call rather than at load.
 */
export function writeCodexMCP(
  servers: Array<{ slug: string; endpoint: string }>,
  apiKey: string | undefined
): ConfigResult {
  const path = codexConfigPath();
  const config = readToml(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid TOML` };

  const mcp = { ...((config.mcp_servers as Record<string, unknown>) ?? {}) };
  for (const s of servers) {
    mcp[`aisa-${s.slug}`] = {
      type: "http",
      url: s.endpoint,
      ...(apiKey ? { http_headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    };
  }
  config.mcp_servers = mcp;
  writeToml(path, config);
  return { ok: true, path };
}
