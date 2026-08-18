export const VERSION = "0.2.4";
/** Root of the platform. Per-surface bases are derived in api.ts#resolveBases. */
export const BASE_URL = "https://api.aisa.one";
export const ENV_VAR_NAME = "AISA_API_KEY";
/**
 * The MCP discovery manifest — the single source of truth for which servers
 * exist and where they live. The CLI deliberately knows no server list of its
 * own: servers ship and retire on the platform side, and reading the manifest
 * at setup time means a new server works without a CLI release (the same
 * philosophy as LLM_ROUTE_PREFIXES below, applied to the fast-moving side).
 *
 * History: until v0.2.4 this file hardcoded MCP_URL = "https://docs.aisa.one/mcp",
 * a host that does not resolve — every `aisa mcp setup` wrote a dead entry into
 * users' configs, and nothing noticed because the command had no tests.
 */
export const MCP_MANIFEST_URL = "https://aisa.one/.well-known/mcp.json";

/** Mintlify's docs-search MCP (3 tools: search/read/feedback). Unauthenticated. */
export const DOCS_MCP_URL = "https://aisa.one/docs/mcp";

/**
 * Servers configured by default. Eleven entries per client is a lot of config;
 * these five cover the broadest agent needs, and `--all` configures everything
 * the manifest lists as live.
 */
export const MCP_DEFAULT_SLUGS: readonly string[] = [
  "web-search",
  "twitter-api",
  "crypto-market-data",
  "marketpulse",
  "stock-pulse",
];

/**
 * First path segment of every route the LLM gateway serves under /v1 (plus
 * /v1beta for Gemini). Everything else is an integration API under /apis/v1.
 *
 * This list is deliberately the whitelist rather than the provider slugs: the
 * gateway routes are hardcoded server-side and change about once a year, while
 * provider slugs are data that operations add and remove continuously. Keeping
 * the whitelist on the slow-moving side means a newly added provider works
 * without a CLI release.
 */
export const LLM_ROUTE_PREFIXES: readonly string[] = [
  "chat",
  "responses",
  "embeddings",
  "messages",
  "models",
  "rerank",
  "classify",
  "images",
  "credits",
  "video",
  "v1beta",
];

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
  windsurf: {
    path: "~/.codeium/windsurf/mcp_config.json",
    key: "mcpServers",
    shape: "stdio",
  },
};

/**
 * Ticker symbol → CoinGecko coin id.
 *
 * CoinGecko keys everything by id ("bitcoin"), not symbol ("BTC"), and dozens
 * of unrelated tokens share popular symbols — resolving by symbol alone would
 * happily return the price of the wrong coin. This table covers the symbols
 * people actually type; anything else falls back to an explicit lookup.
 */
export const COINGECKO_IDS: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  usdt: "tether",
  bnb: "binancecoin",
  sol: "solana",
  usdc: "usd-coin",
  xrp: "ripple",
  doge: "dogecoin",
  ada: "cardano",
  trx: "tron",
  avax: "avalanche-2",
  shib: "shiba-inu",
  dot: "polkadot",
  link: "chainlink",
  bch: "bitcoin-cash",
  near: "near",
  matic: "matic-network",
  ltc: "litecoin",
  icp: "internet-computer",
  uni: "uniswap",
  leo: "leo-token",
  dai: "dai",
  etc: "ethereum-classic",
  apt: "aptos",
  render: "render-token",
  hbar: "hedera-hashgraph",
  fil: "filecoin",
  arb: "arbitrum",
  atom: "cosmos",
  imx: "immutable-x",
  op: "optimism",
  vet: "vechain",
  inj: "injective-protocol",
  sui: "sui",
  ton: "the-open-network",
  pepe: "pepe",
  tao: "bittensor",
  sei: "sei-network",
  aave: "aave",
  algo: "algorand",
  xlm: "stellar",
  cro: "crypto-com-chain",
  mnt: "mantle",
  wld: "worldcoin-wld",
};

/**
 * Models routed to /v1/video/generations, and the request body each one wants.
 *
 * The gateway only rewrites the top-level `model` and passes the rest through,
 * so the body shape belongs to whichever vendor owns the model — a Bailian-style
 * `{input, parameters}` sent to Seedance is rejected outright with a 400.
 *
 * `requiresMedia` records the `input.media[].type` an image/clip-driven model
 * needs. Without it the upstream accepts the submission and only fails a minute
 * later, after billing, so the CLI refuses up front instead.
 */
export type VideoFamily = "bailian" | "seedance";

export interface VideoModelSpec {
  family: VideoFamily;
  requiresMedia?: MediaType;
}

/** Accepted values for `input.media[].type` (enumerated by the upstream error). */
export const MEDIA_TYPES = ["first_frame", "last_frame", "driving_audio", "first_clip"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const VIDEO_MODELS: Record<string, VideoModelSpec> = {
  "wan2.7-t2v": { family: "bailian" },
  "wan2.7-i2v": { family: "bailian", requiresMedia: "first_frame" },
  "wan2.7-r2v": { family: "bailian", requiresMedia: "first_clip" },
  "happyhorse-1.1-t2v": { family: "bailian" },
  "happyhorse-1.1-i2v": { family: "bailian", requiresMedia: "first_frame" },
  "happyhorse-1.1-r2v": { family: "bailian", requiresMedia: "first_clip" },
  "dreamina-seedance-2-0-260128": { family: "seedance" },
  "dreamina-seedance-2-0-fast-260128": { family: "seedance" },
};

export const DEFAULT_VIDEO_MODEL = "wan2.7-t2v";

/** Model families are matched by prefix so new revisions work without a release. */
export function videoModelSpec(model: string): VideoModelSpec {
  if (VIDEO_MODELS[model]) return VIDEO_MODELS[model];

  const family: VideoFamily = model.startsWith("dreamina-seedance") ? "seedance" : "bailian";
  if (/-i2v\b|-i2v$/.test(model)) return { family, requiresMedia: "first_frame" };
  if (/-r2v\b|-r2v$/.test(model)) return { family, requiresMedia: "first_clip" };
  return { family };
}

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
