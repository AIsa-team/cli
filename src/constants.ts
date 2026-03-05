export const VERSION = "0.1.8";
export const BASE_URL = "https://api.aisa.one";
export const CLI_BASE_URL = `${BASE_URL}/v1`;
export const APIS_BASE_URL = `${BASE_URL}/apis/v1`;
export const ENV_VAR_NAME = "AISA_API_KEY";
export const MCP_URL = "https://docs.aisa.one/mcp";

export const AGENT_DIRS: Record<string, string> = {
  claude: "~/.claude/skills/",
  cursor: "~/.cursor/skills/",
  copilot: "~/.github/skills/",
  windsurf: "~/.codeium/windsurf/skills/",
  codex: "~/.agents/skills/",
  gemini: "~/.gemini/skills/",
  openclaw: "~/.openclaw/skills/",
};

export const MCP_CONFIGS: Record<string, { path: string; key: string }> = {
  cursor: { path: "~/.cursor/mcp.json", key: "mcpServers" },
  "claude-desktop": {
    path: "~/Library/Application Support/Claude/claude_desktop_config.json",
    key: "mcpServers",
  },
  windsurf: {
    path: "~/.codeium/windsurf/mcp_config.json",
    key: "mcpServers",
  },
};

export const API_CATEGORIES = [
  "llm",
  "search",
  "finance",
  "twitter",
  "video",
  "scholar",
] as const;

export type ApiCategory = (typeof API_CATEGORIES)[number];

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
