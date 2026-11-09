import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * First tests this command has ever had. The bug they exist to prevent:
 * v0.2.4 wrote a hardcoded, non-resolving URL into three clients' configs and
 * nothing could notice, because setup verified nothing and status only
 * checked that a key existed in a JSON file.
 */

const MANIFEST = {
  servers: [
    {
      slug: "web-search",
      name: "AIsa Web Search",
      status: "live",
      transport: { type: "streamable-http", endpoint: "https://mcp.aisa.one/web-search/mcp" },
      tools: [{ name: "post_tavily_search" }, { name: "post_exa_search" }],
    },
    {
      slug: "twitter-api",
      name: "AIsa Twitter API",
      status: "live",
      transport: { type: "streamable-http", endpoint: "https://mcp.aisa.one/twitter-api/mcp" },
      tools: [{ name: "get_twitter_user_info" }],
    },
    {
      slug: "reddit",
      name: "AIsa Reddit",
      status: "live",
      transport: { type: "streamable-http", endpoint: "https://mcp.aisa.one/reddit/mcp" },
      tools: [{ name: "get_reddit_search" }],
    },
    // planned entries must never be configured: they have no endpoint to dial
    { slug: "seo-keyword-research", name: "SEO", status: "planned" },
  ],
};

let home: string;
let apiKey: string | undefined;

vi.mock("../src/config.js", () => ({
  getAccessToken: async () => apiKey,
}));

function stubManifest(status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL) => {
    if (String(url) === "https://connect.aisa.one/servers") {
      return new Response(status === 200 ? JSON.stringify(MANIFEST) : "nope", { status });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function freshMcp() {
  vi.resetModules();
  return import("../src/commands/mcp.js");
}

function cursorConfig(): Record<string, any> {
  return JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf-8"));
}

function claudeConfig(): Record<string, any> {
  return JSON.parse(
    readFileSync(
      join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      "utf-8"
    )
  );
}

/** Make a client look installed. Detection keys off the config directory, so
 *  creating it is exactly what having the editor on the machine looks like. */
function pretendInstalled(...clients: string[]): void {
  for (const c of clients) {
    const dir =
      c === "cursor" ? join(home, ".cursor")
      : join(home, "Library", "Application Support", "Claude");
    mkdirSync(dir, { recursive: true });
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-home-"));
  process.env.HOME = home;
  // Setup writes only where a client lives — before 2026-08-25 it wrote
  // everywhere, which is how a machine without Windsurf got ~/.codeium/.
  pretendInstalled("cursor", "claude-desktop");
  apiKey = "sk-test-123";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("mcp setup", () => {
  it("writes url entries with a Bearer header for cursor", async () => {
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", yes: true });

    const entries = cursorConfig().mcpServers;
    expect(entries["aisa-router"]).toEqual({
      url: "https://mcp.aisa.one/mcp",
      headers: { Authorization: "Bearer sk-test-123" },
    });
    expect(Object.keys(entries)).toEqual(["aisa-router"]);
  });

  it("writes the minted key, never the expiring OAuth access token", async () => {
    apiKey = "oauth-access-token";
    const fetchMock = stubManifest();
    const manifest = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).endsWith("/v1/keys/mint") ? Response.json({ key: "sk-minted" }) : manifest(url)
    );
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", yes: true });

    expect(cursorConfig().mcpServers["aisa-router"].headers).toEqual({ Authorization: "Bearer sk-minted" });
    expect(readFileSync(join(home, ".cursor", "mcp.json"), "utf-8")).not.toContain("oauth-access-token");
  });

  it("writes nothing when the key cannot be minted", async () => {
    apiKey = "oauth-access-token";
    const fetchMock = stubManifest();
    const manifest = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).endsWith("/v1/keys/mint") ? Response.json({ error: "unauthorized" }, { status: 401 }) : manifest(url)
    );
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", yes: true });

    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("writes an mcp-remote stdio bridge for claude-desktop", async () => {
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "claude-desktop", yes: true });

    const entry = claudeConfig().mcpServers["aisa-router"];
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual([
      "-y",
      "mcp-remote",
      "https://mcp.aisa.one/mcp",
      "--header",
      "Authorization:Bearer sk-test-123",
      "--transport",
      "http-only",
    ]);
    // no url key: Claude Desktop silently ignores url entries, which was the
    // second half of the old bug
    expect(entry.url).toBeUndefined();
  });

  it("omits credentials entirely when no key is configured, so the OAuth challenge drives auth", async () => {
    apiKey = undefined;
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ yes: true });

    expect(cursorConfig().mcpServers["aisa-router"].headers).toBeUndefined();
    const args: string[] = claudeConfig().mcpServers["aisa-router"].args;
    expect(args).not.toContain("--header");
  });

  it("--all still configures only the unified entry", async () => {
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", all: true, yes: true });
    expect(Object.keys(cursorConfig().mcpServers)).toEqual(["aisa-router"]);
  });

  it("preserves legacy, docs and unrelated entries when adding the Router", async () => {
    const dir = join(home, ".cursor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          aisa: { url: "https://docs.aisa.one/mcp" }, // the v0.2.4 dead entry
          "aisa-web-search": { url: "https://mcp.aisa.one/web-search/mcp", headers: { Authorization: "Bearer old" } },
          "aisa-docs": { url: "https://aisa.one/docs/mcp" },
          mine: { url: "https://example.com/mcp" }, // the user's own — untouchable
        },
      })
    );
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", yes: true });

    const entries = cursorConfig().mcpServers;
    expect(entries["aisa"]).toEqual({ url: "https://docs.aisa.one/mcp" });
    expect(entries["aisa-web-search"]).toEqual({ url: "https://mcp.aisa.one/web-search/mcp", headers: { Authorization: "Bearer old" } });
    expect(entries["aisa-docs"]).toEqual({ url: "https://aisa.one/docs/mcp" });
    expect(entries["aisa-router"].url).toBe("https://mcp.aisa.one/mcp");
    expect(entries["mine"]).toEqual({ url: "https://example.com/mcp" });
  });

  it("writes nothing at all when the manifest cannot be fetched", async () => {
    stubManifest(503);
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", yes: true });

    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("rejects an unknown agent before fetching anything", async () => {
    const fetchMock = stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "emacs" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("unified discovery", () => {
  it("reads only Connect and ignores legacy endpoint/count metadata", async () => {
    const fetchMock = stubManifest();
    const { fetchLiveServers } = await freshMcp();
    const servers = await fetchLiveServers();
    expect(servers).toEqual([expect.objectContaining({ slug: "router", endpoint: "https://mcp.aisa.one/mcp", toolCount: 5 })]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["https://connect.aisa.one/servers"]);
  });

  it("never falls back to the old manifest on a directory failure", async () => {
    const fetchMock = stubManifest(404);
    const { fetchLiveServers } = await freshMcp();
    await expect(fetchLiveServers()).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed auxiliary directory data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ entrypoints: [] })));
    const { fetchLiveServers } = await freshMcp();
    await expect(fetchLiveServers()).rejects.toThrow("missing servers array");
  });

  it("rejects retired selections before writing a client config", async () => {
    const { writeClientConfig, isUnifiedMcpSelection } = await freshMcp();
    const old = [{ slug: "web-search", endpoint: "https://mcp.aisa.one/web-search/mcp", name: "Web", toolCount: 1, description: "", category: "Search" }];
    expect(isUnifiedMcpSelection(old)).toBe(false);
    expect(writeClientConfig("cursor", old, undefined).ok).toBe(false);
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("status probes only the unified resource, leaving legacy entries untouched", async () => {
    const path = join(home, ".cursor", "mcp.json");
    const contents = JSON.stringify({ mcpServers: { "aisa-router": { url: "https://mcp.aisa.one/mcp" }, "aisa-web-search": { url: "https://mcp.aisa.one/web-search/mcp" }, "aisa-docs": { url: "https://aisa.one/docs/mcp" } } });
    writeFileSync(path, contents);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { mcpStatusAction } = await freshMcp();
    await mcpStatusAction();
    expect(fetchMock.mock.calls.map((args: any[]) => args[0])).toEqual(["https://mcp.aisa.one/mcp"]);
    expect(readFileSync(path, "utf8")).toBe(contents);
  });
});

/**
 * The two guards added 2026-08-25, after `aisa mcp setup` with no arguments
 * wrote three config files on a live machine without being asked — one of them
 * for Windsurf, which was not installed. That write created ~/.codeium/, and
 * connect's detection (which keys off the config directory existing) then
 * offered a Windsurf card for an editor that had never been there: this
 * command's output became that command's input.
 */
describe("mcp setup guards", () => {
  it("writes nothing without --yes, and says what it would have written", async () => {
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor" });

    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it("skips a client that is not installed rather than creating its directory", async () => {
    rmSync(join(home, "Library"), { recursive: true, force: true }); // no Claude Desktop
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ yes: true });

    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(true);
    expect(existsSync(join(home, "Library", "Application Support", "Claude"))).toBe(false);
  });

  it("refuses outright when nothing requested is installed", async () => {
    rmSync(join(home, ".cursor"), { recursive: true, force: true });
    rmSync(join(home, "Library"), { recursive: true, force: true });
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ yes: true });

    expect(process.exitCode).toBe(1);
    expect(existsSync(join(home, ".cursor"))).toBe(false);
  });
});

describe("pingEndpoint", () => {
  async function ping(status: number | Error): Promise<string> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (status instanceof Error) throw status;
        return new Response("{}", { status: status as number });
      })
    );
    const { pingEndpoint } = await freshMcp();
    return pingEndpoint("https://mcp.aisa.one/x/mcp");
  }

  it("reads 401 as healthy — that is the auth challenge, not a failure", async () => {
    expect(await ping(401)).toContain("auth required");
  });

  it("reads 200 as open", async () => {
    expect(await ping(200)).toContain("open");
  });

  it("reports the dead-hostname class loudly", async () => {
    expect(await ping(new Error("getaddrinfo ENOTFOUND docs.aisa.one"))).toContain("unreachable");
  });
});

describe("mcp setup — unparseable configs", () => {
  it("refuses to touch a config file it cannot parse", async () => {
    const dir = join(home, ".cursor");
    mkdirSync(dir, { recursive: true });
    const handEdited = '{\n  // my servers\n  "mcpServers": {"mine": {"url": "https://example.com"}},\n}\n';
    writeFileSync(join(dir, "mcp.json"), handEdited);

    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor", yes: true });

    // byte-identical: a "setup" must never destroy a hand-edited config,
    // which is exactly what the old command did (it replaced it with {})
    expect(readFileSync(join(dir, "mcp.json"), "utf-8")).toBe(handEdited);
  });
});
