export const VERSION = "0.6.9";
/** Default for chat when no model is configured or supplied explicitly. */
export const DEFAULT_CHAT_MODEL = "deepseek-v4.1-flash";
/** Root of the platform. Per-surface bases are derived in api.ts#resolveBases. */
export const BASE_URL = "https://api.aisa.one";
export const ENV_VAR_NAME = "AISA_API_KEY";
/** The only business MCP resource configured by this CLI. */
export const MCP_URL = "https://mcp.aisa.one/mcp";

/** Where credit is added. Payment always finishes in a browser — Stripe's
 *  hosted page owns the card details, and 3-D Secure needs one. */
/** The account surface. Printed where someone can act on it, not linked. */
export const CONSOLE_URL = "https://console.aisa.one";
export const CONSOLE_BILLING_URL = "https://console.aisa.one/billing";

/** Anthropic-shaped base for Claude Code: it appends /v1/messages itself. */
export const LLM_BASE_URL = "https://api.aisa.one";

/** Codex speaks the Responses API and appends /responses, so it needs the
 *  /v1 root rather than the host. */
export const LLM_RESPONSES_BASE_URL = "https://api.aisa.one/v1";

/** The provider name written into Codex's config.toml. Frozen: renaming it
 *  orphans the block we would otherwise remove cleanly. */
export const AISA_PROVIDER_ID = "aisa";

export const AGENT_DIRS: Record<string, string> = {
  claude: "~/.claude/skills/",
  cursor: "~/.cursor/skills/",
  copilot: "~/.github/skills/",
  windsurf: "~/.codeium/windsurf/skills/",
  codex: "~/.agents/skills/",
  gemini: "~/.gemini/skills/",
  openclaw: "~/.openclaw/skills/",
};

/**
 * Per-client config shape. This is the part v0.2.4 got wrong even apart from
 * the dead URL: it wrote `{url}` everywhere, but Claude Desktop's mcpServers
 * only executes command/args (stdio) entries and silently ignores url ones.
 * Stdio clients get an `npx mcp-remote` bridge instead — verified end to end
 * against mcp.aisa.one (initialize -> tools/list -> tools/call) on 2026-08-18.
 */
export const MCP_CONFIGS: Record<string, { path: string; key: string; shape: "url" | "stdio" }> = {
  cursor: { path: "~/.cursor/mcp.json", key: "mcpServers", shape: "url" },
  "claude-desktop": {
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
    key: "mcpServers",
    shape: "stdio",
  },
};

/**
 * Windsurf was here until 2026-08-25 and was removed, not because it cannot be
 * configured but because being listed did harm on a machine without it.
 *
 * `detectClients()` decides a client is present by whether the parent of its
 * config path exists. `aisa mcp setup` with no --agent wrote to every entry in
 * this table regardless of what was installed — so on a machine with no
 * Windsurf it created ~/.codeium/windsurf/, and the next `aisa connect`
 * offered a Windsurf card for an editor that was never there. A stale entry in
 * this table is not inert: it is an input to detection.
 *
 * The T2 page had already been filtering it out by hand, which was the same
 * observation reached one layer too late.
 */

/**
 * Client-side grouping of integration providers.
 *
 * The catalog returns no description or tags — `buildCatalogItem` never
 * populates them — so there is nothing server-side to filter on. Entries are
 * matched by prefix, which keeps the polymarket-* family together.
 */
export const PROVIDER_CATEGORIES: Record<string, string[]> = {
  finance: ["financial", "fred", "edinet", "coingecko", "polymarket", "kalshi"],
  search: [
    "search",
    "tavily",
    "brave",
    "exa",
    "perplexity",
    "querit",
    "parallel",
    "dataforseo",
    "jina",
    "scholar",
  ],
  social: ["twitter", "aisa-twitter", "youtube", "scrape-creators", "waveinflu"],
  productivity: ["agentmail", "apollo", "composio"],
};

export function categoryOf(providerId: string): string {
  for (const [category, prefixes] of Object.entries(PROVIDER_CATEGORIES)) {
    if (prefixes.some((p) => providerId === p || providerId.startsWith(`${p}-`) || providerId.startsWith(`${p}.`))) {
      return category;
    }
  }
  return "other";
}

export const API_CATEGORIES = [...Object.keys(PROVIDER_CATEGORIES), "other"] as const;

export const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "xai",
  "moonshot",
  "alibaba",
  "bytedance",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export const AUTH_SERVER = "https://clerk.aisa.one";
export const AUTH_SETUP_GUIDANCE =
  `Run "aisa login" to sign in with OAuth. For CI, set ${ENV_VAR_NAME} or use "aisa login --key <key>".`;
export const MISSING_API_KEY_GUIDANCE = `Not authenticated. ${AUTH_SETUP_GUIDANCE}`;
