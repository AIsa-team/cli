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
/** Codex ≥0.149: `--profile <name>` layers this file on top of the base
 *  config rather than reading a `[profiles.<name>]` table — see
 *  writeCodexAisaProfile for the migration this replaced. */
const codexAisaProfilePath = () => expandHome("~/.codex/aisa.config.toml");

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

/**
 * Swap an entry's env-var token reference for the literal Authorization header.
 *
 * `codex mcp add --bearer-token-env-var` is the official way to add a keyed
 * entry without triggering the OAuth flow, but it records only the variable
 * NAME — at runtime Codex reads the token from its own process environment,
 * and nothing guarantees the user's shell exports it. `http_headers` is the
 * field Codex accepts for a literal header (`bearer_token` is explicitly
 * rejected by its config loader), and it matches what the Claude Code path
 * already stores via --header. The env-var reference is removed so the entry
 * has exactly one source of credentials.
 */
export function patchCodexMCPAuth(name: string, apiKey: string): ConfigResult {
  const path = codexConfigPath();
  const config = readToml(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid TOML` };

  const servers = config.mcp_servers as Record<string, Record<string, unknown>> | undefined;
  const entry = servers?.[name];
  if (!entry) return { ok: false, reason: `no MCP entry named ${name} in ${path}` };

  delete entry.bearer_token_env_var;
  entry.http_headers = { Authorization: `Bearer ${apiKey}` };
  writeToml(path, config);
  return { ok: true, path };
}

// ── opencode ────────────────────────────────────────────────────────────────
//
// opencode has no `mcp add` command at all — its whole surface is one JSON
// document, ~/.config/opencode/opencode.json, validated against the schema
// at opencode.ai/config.json. Both the model provider and the MCP servers
// are keys in that document, so this section is two writers over the same
// file, with the same removal-by-key discipline as the other clients.

// `opencode mcp add` creates opencode.jsonc; the schema site says .json.
// Both are read by opencode — write whichever already exists (jsonc wins,
// since the official command creates it), so there is never a second file
// fighting the first.
function opencodeConfigPath(): string {
  const jsonc = expandHome("~/.config/opencode/opencode.jsonc");
  if (existsSync(jsonc)) return jsonc;
  return expandHome("~/.config/opencode/opencode.json");
}

/**
 * Register AIsa as a custom provider and point the default models at it.
 *
 * `@ai-sdk/anthropic` is the runtime (opencode loads providers as Vercel AI
 * SDK packages): our gateway's /v1/messages face is live and verified with a
 * real Claude Code session, and the anthropic SDK is the pairing that face
 * was built for. Models are declared explicitly — a custom provider has no
 * models.dev entry to inherit from.
 */
export function writeOpencodeLLM(apiKey: string, models: ModelChoice = DEFAULT_MODELS): ConfigResult {
  const path = opencodeConfigPath();
  const config = readJson(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid JSON` };

  config.$schema ??= "https://opencode.ai/config.json";
  const provider = { ...((config.provider as Record<string, unknown>) ?? {}) };
  provider[AISA_PROVIDER_ID] = {
    npm: "@ai-sdk/anthropic",
    name: "AIsa",
    options: { baseURL: `${LLM_BASE_URL}/v1`, apiKey },
    models: {
      [models.model]: { name: models.model },
      [models.smallModel]: { name: models.smallModel },
    },
  };
  config.provider = provider;
  config.model = `${AISA_PROVIDER_ID}/${models.model}`;
  config.small_model = `${AISA_PROVIDER_ID}/${models.smallModel}`;

  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

export function removeOpencodeLLM(): ConfigResult {
  const path = opencodeConfigPath();
  if (!existsSync(path)) return { ok: true, path };
  const config = readJson(path);
  if (config === null) return { ok: false, reason: `${path} is not valid JSON` };

  const provider = config.provider as Record<string, unknown> | undefined;
  if (provider) {
    delete provider[AISA_PROVIDER_ID];
    if (Object.keys(provider).length === 0) delete config.provider;
  }
  // Only unset the defaults if they still point at us — a user who switched
  // to another provider keeps their choice.
  if (typeof config.model === "string" && config.model.startsWith(`${AISA_PROVIDER_ID}/`))
    delete config.model;
  if (typeof config.small_model === "string" && config.small_model.startsWith(`${AISA_PROVIDER_ID}/`))
    delete config.small_model;
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

/**
 * Write the MCP entries. With a key the entry carries the literal
 * Authorization header; without one, `oauth: {}` tells opencode to run its
 * own MCP OAuth (dynamic client registration per its schema).
 */
export function writeOpencodeMCP(
  servers: Array<{ slug: string; endpoint: string }>,
  apiKey: string | undefined
): ConfigResult {
  const path = opencodeConfigPath();
  const config = readJson(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid JSON` };

  config.$schema ??= "https://opencode.ai/config.json";
  const mcp = { ...((config.mcp as Record<string, unknown>) ?? {}) };
  for (const s of servers) {
    mcp[`aisa-${s.slug}`] = {
      type: "remote",
      url: s.endpoint,
      enabled: true,
      ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : { oauth: {} }),
    };
  }
  config.mcp = mcp;
  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}

// ── backup mode ─────────────────────────────────────────────────────────────
//
// "Add AIsa as a backup" for a user who already has working models: nothing
// they rely on changes. Codex gets the provider plus an aisa.config.toml
// profile (its native mechanism — `codex --profile aisa` layers it in for
// one session, the default stays theirs); opencode gets the provider only
// (its TUI lists models across providers, switching is built in). Claude
// Code has no coexistence mechanism in its config, so its backup lives
// entirely outside: a settings file under ~/.aisa driven through --settings
// (see wrappers.ts).

/**
 * Codex backup: provider + catalog in the base config, top-level defaults
 * untouched, and a standalone aisa.config.toml that `codex --profile aisa`
 * (or the codex-aisa wrapper) layers on top of it.
 *
 * That standalone file is Codex ≥0.149's replacement for the old
 * `[profiles.aisa]` table — `--profile <name>` now means "layer
 * `$CODEX_HOME/<name>.config.toml`", and Codex refuses to start at all if
 * the legacy table for that name still exists in config.toml alongside it
 * (hit live 2026-08-24, codex-cli 0.149.1: "cannot be used while
 * config.toml contains legacy `profile = \"aisa\"` or `[profiles.aisa]`").
 * A machine still carrying that table from an earlier version of this
 * writer gets it removed here — a one-time, one-way migration; nothing a
 * user typed into it themselves would collide with a section this narrow.
 */
export function writeCodexAisaProfile(
  apiKey: string,
  models: ModelChoice = CODEX_DEFAULT_MODELS
): ConfigResult {
  const path = codexConfigPath();
  const config = readToml(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid TOML` };

  writeCodexModelCatalog(models);
  const providers = { ...((config.model_providers as Record<string, unknown>) ?? {}) };
  providers[AISA_PROVIDER_ID] = {
    name: "AIsa",
    base_url: LLM_RESPONSES_BASE_URL,
    experimental_bearer_token: apiKey,
    wire_api: "responses",
  };
  config.model_providers = providers;
  config.model_catalog_json = CODEX_MODELS_PATH;
  if (config.profiles && typeof config.profiles === "object") {
    const profiles = { ...(config.profiles as Record<string, unknown>) };
    delete profiles[AISA_PROVIDER_ID];
    if (Object.keys(profiles).length > 0) config.profiles = profiles;
    else delete config.profiles;
  }
  writeToml(path, config);

  writeToml(codexAisaProfilePath(), { model_provider: AISA_PROVIDER_ID, model: models.model });
  return { ok: true, path: codexAisaProfilePath() };
}

/**
 * opencode backup: provider declared, `model`/`small_model` left alone — the
 * user picks aisa/<model> in the TUI whenever they want it.
 */
export function writeOpencodeAisaBackup(
  apiKey: string,
  models: ModelChoice = DEFAULT_MODELS
): ConfigResult {
  const path = opencodeConfigPath();
  const config = readJson(path);
  if (config === null) return { ok: false, reason: `${path} exists but is not valid JSON` };

  config.$schema ??= "https://opencode.ai/config.json";
  const provider = { ...((config.provider as Record<string, unknown>) ?? {}) };
  provider[AISA_PROVIDER_ID] = {
    npm: "@ai-sdk/anthropic",
    name: "AIsa",
    options: { baseURL: `${LLM_BASE_URL}/v1`, apiKey },
    models: {
      [models.model]: { name: models.model },
      [models.smallModel]: { name: models.smallModel },
    },
  };
  config.provider = provider;
  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return { ok: true, path };
}
