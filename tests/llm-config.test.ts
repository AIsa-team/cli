import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as TOML from "smol-toml";

/**
 * These writers edit files a user also edits by hand, so the tests care about
 * two things above all: what we add, and that everything else survives — in
 * both directions. A config that loses a user's own settings on removal is
 * worse than one that never wrote them.
 */

let home: string;

vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

const {
  writeClaudeCodeLLM,
  removeClaudeCodeLLM,
  writeCodexLLM,
  removeCodexLLM,
  writeCodexMCP,
  patchCodexMCPAuth,
  writeOpencodeLLM,
  removeOpencodeLLM,
  writeOpencodeMCP,
  DEFAULT_MODELS,
  CODEX_DEFAULT_MODELS,
  defaultModelsFor,
} = await import("../src/commands/llm-config.js");
const { LLM_BASE_URL, LLM_RESPONSES_BASE_URL, AISA_PROVIDER_ID } = await import(
  "../src/constants.js"
);

const claudePath = () => join(home, ".claude", "settings.json");
const codexPath = () => join(home, ".codex", "config.toml");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
const readToml = (p: string) => TOML.parse(readFileSync(p, "utf-8")) as Record<string, any>;

function seed(path: string, contents: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf-8");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-llm-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("Claude Code LLM config", () => {
  it("writes the env block into a file that does not exist yet", () => {
    const res = writeClaudeCodeLLM("sk-test");
    expect(res.ok).toBe(true);
    const env = readJson(claudePath()).env;
    expect(env.ANTHROPIC_BASE_URL).toBe(LLM_BASE_URL);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-test");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(DEFAULT_MODELS.model);
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(DEFAULT_MODELS.smallModel);
  });

  it("keeps the user's other settings and other env vars", () => {
    seed(claudePath(), JSON.stringify({ theme: "dark", env: { MY_VAR: "keep" } }));
    writeClaudeCodeLLM("sk-test");
    const after = readJson(claudePath());
    expect(after.theme).toBe("dark");
    expect(after.env.MY_VAR).toBe("keep");
  });

  it("removes only the keys it wrote", () => {
    seed(claudePath(), JSON.stringify({ theme: "dark", env: { MY_VAR: "keep" } }));
    writeClaudeCodeLLM("sk-test");
    removeClaudeCodeLLM();
    const after = readJson(claudePath());
    expect(after.theme).toBe("dark");
    expect(after.env).toEqual({ MY_VAR: "keep" });
  });

  it("drops an env block that held nothing else", () => {
    writeClaudeCodeLLM("sk-test");
    removeClaudeCodeLLM();
    expect(readJson(claudePath()).env).toBeUndefined();
  });

  it("refuses a settings file that does not parse", () => {
    seed(claudePath(), "{ not json");
    const res = writeClaudeCodeLLM("sk-test");
    expect(res.ok).toBe(false);
    // And leaves it exactly as it found it.
    expect(readFileSync(claudePath(), "utf-8")).toBe("{ not json");
  });
});

describe("Codex LLM config", () => {
  it("registers the provider with the Responses wire API", () => {
    const res = writeCodexLLM("sk-test");
    expect(res.ok).toBe(true);
    const config = readToml(codexPath());
    expect(config.model_provider).toBe(AISA_PROVIDER_ID);
    expect(config.model).toBe(CODEX_DEFAULT_MODELS.model);
    const provider = config.model_providers[AISA_PROVIDER_ID];
    expect(provider.base_url).toBe(LLM_RESPONSES_BASE_URL);
    expect(provider.wire_api).toBe("responses");
    expect(provider.experimental_bearer_token).toBe("sk-test");
  });

  it("leaves another provider and unrelated keys alone", () => {
    seed(
      codexPath(),
      TOML.stringify({
        approval_policy: "on-request",
        model_providers: { other: { name: "Other", base_url: "https://other.example" } },
      })
    );
    writeCodexLLM("sk-test");
    const config = readToml(codexPath());
    expect(config.approval_policy).toBe("on-request");
    expect(config.model_providers.other.base_url).toBe("https://other.example");
  });

  it("removes its provider without touching the user's", () => {
    seed(
      codexPath(),
      TOML.stringify({
        approval_policy: "on-request",
        model_providers: { other: { name: "Other", base_url: "https://other.example" } },
      })
    );
    writeCodexLLM("sk-test");
    removeCodexLLM();
    const config = readToml(codexPath());
    expect(config.model_providers.aisa).toBeUndefined();
    expect(config.model_providers.other).toBeDefined();
    expect(config.approval_policy).toBe("on-request");
    expect(config.model_provider).toBeUndefined();
  });

  it("keeps a model_provider the user switched to something else", () => {
    writeCodexLLM("sk-test");
    const config = readToml(codexPath());
    config.model_provider = "other";
    writeFileSync(codexPath(), TOML.stringify(config), "utf-8");
    removeCodexLLM();
    expect(readToml(codexPath()).model_provider).toBe("other");
  });

  it("refuses a config that does not parse", () => {
    seed(codexPath(), "not = = toml");
    expect(writeCodexLLM("sk-test").ok).toBe(false);
    expect(readFileSync(codexPath(), "utf-8")).toBe("not = = toml");
  });
});

describe("patchCodexMCPAuth", () => {
  // What `codex mcp add --url --bearer-token-env-var` leaves behind.
  const seedAdded = () =>
    seed(
      codexPath(),
      TOML.stringify({
        approval_policy: "on-request",
        mcp_servers: {
          "aisa-web-search": {
            url: "https://mcp.aisa.one/web-search/mcp",
            bearer_token_env_var: "AISA_API_KEY",
          },
          other: { url: "https://other.example/mcp" },
        },
      })
    );

  it("replaces the env-var reference with the literal header", () => {
    seedAdded();
    const res = patchCodexMCPAuth("aisa-web-search", "sk-test");
    expect(res.ok).toBe(true);
    const entry = readToml(codexPath()).mcp_servers["aisa-web-search"];
    expect(entry.bearer_token_env_var).toBeUndefined();
    expect(entry.http_headers.Authorization).toBe("Bearer sk-test");
    expect(entry.url).toBe("https://mcp.aisa.one/web-search/mcp");
  });

  it("leaves other entries and unrelated keys alone", () => {
    seedAdded();
    patchCodexMCPAuth("aisa-web-search", "sk-test");
    const config = readToml(codexPath());
    expect(config.approval_policy).toBe("on-request");
    expect(config.mcp_servers.other.url).toBe("https://other.example/mcp");
    expect(config.mcp_servers.other.http_headers).toBeUndefined();
  });

  it("reports a missing entry instead of inventing one", () => {
    seedAdded();
    const res = patchCodexMCPAuth("aisa-nope", "sk-test");
    expect(res.ok).toBe(false);
    expect(readToml(codexPath()).mcp_servers["aisa-nope"]).toBeUndefined();
  });

  it("refuses a config that does not parse", () => {
    seed(codexPath(), "not = = toml");
    expect(patchCodexMCPAuth("aisa-web-search", "sk-test").ok).toBe(false);
    expect(readFileSync(codexPath(), "utf-8")).toBe("not = = toml");
  });
});

describe("opencode config", () => {
  const ocPath = () => join(home, ".config", "opencode", "opencode.json");
  const servers = [{ slug: "web-search", endpoint: "https://mcp.aisa.one/web-search/mcp" }];

  it("registers the provider with the anthropic SDK and default models", () => {
    const res = writeOpencodeLLM("sk-test");
    expect(res.ok).toBe(true);
    const cfg = readJson(ocPath());
    expect(cfg.$schema).toBe("https://opencode.ai/config.json");
    const p = cfg.provider[AISA_PROVIDER_ID];
    expect(p.npm).toBe("@ai-sdk/anthropic");
    expect(p.options.baseURL).toBe(LLM_BASE_URL + "/v1");
    expect(p.options.apiKey).toBe("sk-test");
    expect(cfg.model).toBe(`${AISA_PROVIDER_ID}/${DEFAULT_MODELS.model}`);
    expect(cfg.small_model).toBe(`${AISA_PROVIDER_ID}/${DEFAULT_MODELS.smallModel}`);
  });

  it("keeps a user's own provider and drops only ours on removal", () => {
    seed(ocPath(), JSON.stringify({ provider: { other: { npm: "x" } }, theme: "dark" }));
    writeOpencodeLLM("sk-test");
    removeOpencodeLLM();
    const cfg = readJson(ocPath());
    expect(cfg.provider.other).toBeDefined();
    expect(cfg.provider[AISA_PROVIDER_ID]).toBeUndefined();
    expect(cfg.model).toBeUndefined();
    expect(cfg.theme).toBe("dark");
  });

  it("keeps a model the user pointed elsewhere", () => {
    writeOpencodeLLM("sk-test");
    const cfg = readJson(ocPath());
    cfg.model = "other/gpt";
    writeFileSync(ocPath(), JSON.stringify(cfg), "utf-8");
    removeOpencodeLLM();
    expect(readJson(ocPath()).model).toBe("other/gpt");
  });

  it("writes remote MCP entries with the key as a literal header", () => {
    writeOpencodeMCP(servers, "sk-test");
    const e = readJson(ocPath()).mcp["aisa-web-search"];
    expect(e.type).toBe("remote");
    expect(e.enabled).toBe(true);
    expect(e.headers.Authorization).toBe("Bearer sk-test");
    expect(e.oauth).toBeUndefined();
  });

  it("asks for opencode's own OAuth when there is no key", () => {
    writeOpencodeMCP(servers, undefined);
    const e = readJson(ocPath()).mcp["aisa-web-search"];
    expect(e.oauth).toEqual({});
    expect(e.headers).toBeUndefined();
  });

  it("refuses a config that does not parse", () => {
    seed(ocPath(), "{ not json");
    expect(writeOpencodeLLM("sk-test").ok).toBe(false);
    expect(writeOpencodeMCP(servers, "sk").ok).toBe(false);
    expect(readFileSync(ocPath(), "utf-8")).toBe("{ not json");
  });
});

describe("model defaults follow the agent", () => {
  it("gives Codex an OpenAI model and Claude Code an Anthropic one", () => {
    expect(defaultModelsFor("codex").model).toMatch(/^gpt-/);
    expect(defaultModelsFor("claude-code").model).toMatch(/^claude-/);
  });

  it("writes each agent its own default", () => {
    writeCodexLLM("sk-test");
    writeClaudeCodeLLM("sk-test");
    expect(readToml(codexPath()).model).toBe(CODEX_DEFAULT_MODELS.model);
    expect(readJson(claudePath()).env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(DEFAULT_MODELS.model);
  });
});

describe("Codex MCP config", () => {
  const servers = [
    { slug: "web-search", endpoint: "https://mcp.aisa.one/web-search/mcp" },
    { slug: "twitter-api", endpoint: "https://mcp.aisa.one/twitter-api/mcp" },
  ];

  it("writes http entries under the aisa- prefix", () => {
    writeCodexMCP(servers, undefined);
    const mcp = readToml(codexPath()).mcp_servers;
    expect(Object.keys(mcp).sort()).toEqual(["aisa-twitter-api", "aisa-web-search"]);
    expect(mcp["aisa-web-search"].type).toBe("http");
    expect(mcp["aisa-web-search"].url).toBe(servers[0].endpoint);
    expect(mcp["aisa-web-search"].http_headers).toBeUndefined();
  });

  it("uses http_headers — Codex's field name — when a key is given", () => {
    writeCodexMCP(servers, "sk-test");
    const entry = readToml(codexPath()).mcp_servers["aisa-web-search"];
    expect(entry.http_headers).toEqual({ Authorization: "Bearer sk-test" });
    expect(entry.headers).toBeUndefined();
  });

  it("coexists with the LLM provider block in the same file", () => {
    writeCodexLLM("sk-test");
    writeCodexMCP(servers, "sk-test");
    const config = readToml(codexPath());
    expect(config.model_providers[AISA_PROVIDER_ID]).toBeDefined();
    expect(config.mcp_servers["aisa-web-search"]).toBeDefined();
  });

  it("leaves a user's own MCP server untouched", () => {
    seed(
      codexPath(),
      TOML.stringify({ mcp_servers: { mine: { type: "local", command: "node", args: ["s.js"] } } })
    );
    writeCodexMCP(servers, undefined);
    const mcp = readToml(codexPath()).mcp_servers;
    expect(mcp.mine.command).toBe("node");
    expect(mcp["aisa-web-search"]).toBeDefined();
  });
});
