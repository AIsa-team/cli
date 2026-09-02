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
  getApiKey: () => apiKey,
}));

function stubManifest(status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL) => {
    if (String(url).includes(".well-known/mcp.json")) {
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

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-home-"));
  process.env.HOME = home;
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
    await mcpSetupAction({ agent: "cursor" });

    const entries = cursorConfig().mcpServers;
    expect(entries["aisa-web-search"]).toEqual({
      url: "https://mcp.aisa.one/web-search/mcp",
      headers: { Authorization: "Bearer sk-test-123" },
    });
    // docs search rides along, unauthenticated
    expect(entries["aisa-docs"]).toEqual({ url: "https://aisa.one/docs/mcp" });
  });

  it("writes an mcp-remote stdio bridge for claude-desktop", async () => {
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "claude-desktop" });

    const entry = claudeConfig().mcpServers["aisa-web-search"];
    expect(entry.command).toBe("npx");
    expect(entry.args).toEqual([
      "-y",
      "mcp-remote",
      "https://mcp.aisa.one/web-search/mcp",
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
    await mcpSetupAction({});

    expect(cursorConfig().mcpServers["aisa-web-search"].headers).toBeUndefined();
    const args: string[] = claudeConfig().mcpServers["aisa-web-search"].args;
    expect(args).not.toContain("--header");
  });

  it("configures only default slugs unless --all, and never a planned server", async () => {
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor" });

    let names = Object.keys(cursorConfig().mcpServers);
    expect(names).toContain("aisa-web-search");
    // The default set is deliberately one server: each is its own OAuth
    // resource, so every extra default costs a keyless user another browser
    // approval. Everything else is live but opt-in.
    expect(names).not.toContain("aisa-twitter-api");
    expect(names).not.toContain("aisa-reddit");

    await mcpSetupAction({ agent: "cursor", all: true });
    names = Object.keys(cursorConfig().mcpServers);
    expect(names).toContain("aisa-reddit");
    expect(names).not.toContain("aisa-seo-keyword-research"); // planned: no endpoint exists
  });

  it("removes the dead entry old releases wrote, and only that one", async () => {
    const dir = join(home, ".cursor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          aisa: { url: "https://docs.aisa.one/mcp" }, // the v0.2.4 dead entry
          mine: { url: "https://example.com/mcp" }, // the user's own — untouchable
        },
      })
    );
    stubManifest();
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor" });

    const entries = cursorConfig().mcpServers;
    expect(entries["aisa"]).toBeUndefined();
    expect(entries["mine"]).toEqual({ url: "https://example.com/mcp" });
  });

  it("writes nothing at all when the manifest cannot be fetched", async () => {
    stubManifest(503);
    const { mcpSetupAction } = await freshMcp();
    await mcpSetupAction({ agent: "cursor" });

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

/**
 * Which document the server list comes from.
 *
 * The manifest is generated offline and committed by hand, so it drifts:
 * measured 2026-08-25 it named 11 servers and 188 tools while mcp.aisa.one was
 * serving 14 and 260 — three servers missing outright. The index is served by
 * the process that owns the answer, so it is tried first. These tests pin the
 * order, the fallback, and the one field whose shape differs between them.
 */
const CATALOG = {
  catalogVersion: 1,
  serverCount: 2,
  servers: [
    {
      slug: "agentmail", name: "AIsa AgentMail", status: "live",
      transport: { type: "streamable-http", endpoint: "https://mcp.aisa.one/agentmail/mcp" },
      toolCount: 49, description: "Email", category: "Communication",
    },
    {
      slug: "web-search", name: "AIsa Web Search", status: "live",
      transport: { type: "streamable-http", endpoint: "https://mcp.aisa.one/web-search/mcp" },
      toolCount: 27, description: "Search", category: "Search & Research",
    },
  ],
};

function stubBoth(catalog: { status: number; body?: unknown }): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    const u = String(url);
    seen.push(u);
    if (u.includes("/servers")) {
      if (catalog.status === 0) throw new TypeError("fetch failed");
      return new Response(catalog.status === 200 ? JSON.stringify(catalog.body ?? CATALOG) : "nope",
                          { status: catalog.status });
    }
    if (u.includes(".well-known/mcp.json")) return new Response(JSON.stringify(MANIFEST), { status: 200 });
    throw new Error(`unexpected fetch: ${u}`);
  }));
  return seen;
}

describe("where the server list comes from", () => {
  it("prefers the live index over the hand-committed manifest", async () => {
    const seen = stubBoth({ status: 200 });
    const { fetchLiveServers } = await freshMcp();
    const servers = await fetchLiveServers();

    expect(seen.some((u) => u.includes("/servers"))).toBe(true);
    expect(seen.some((u) => u.includes(".well-known/mcp.json"))).toBe(false);
    expect(servers.map((s) => s.slug).sort()).toEqual(["agentmail", "web-search"]);
  });

  it("reads toolCount from the index, which carries no tools array", async () => {
    stubBoth({ status: 200 });
    const { fetchLiveServers } = await freshMcp();
    const agentmail = (await fetchLiveServers()).find((s) => s.slug === "agentmail");
    expect(agentmail?.toolCount).toBe(49);
  });

  it("falls back to the manifest when the index is not deployed yet", async () => {
    const seen = stubBoth({ status: 404 });
    const { fetchLiveServers } = await freshMcp();
    const servers = await fetchLiveServers();

    expect(seen.some((u) => u.includes(".well-known/mcp.json"))).toBe(true);
    expect(servers.length).toBeGreaterThan(0);
    // The manifest names tools instead of counting them; the count still lands.
    expect(servers.find((s) => s.slug === "web-search")?.toolCount).toBe(2);
  });

  it("falls back when the index host cannot be reached at all", async () => {
    stubBoth({ status: 0 });
    const { fetchLiveServers } = await freshMcp();
    expect((await fetchLiveServers()).length).toBeGreaterThan(0);
  });

  it("falls back rather than trusting an index that lists nothing live", async () => {
    stubBoth({ status: 200, body: { servers: [] } });
    const { fetchLiveServers } = await freshMcp();
    expect((await fetchLiveServers()).length).toBeGreaterThan(0);
  });

  it("does not spend the retry budget on the index — the fallback is the point", async () => {
    const seen = stubBoth({ status: 0 });
    const { fetchLiveServers } = await freshMcp();
    await fetchLiveServers();
    expect(seen.filter((u) => u.includes("/servers")).length).toBe(1);
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
    await mcpSetupAction({ agent: "cursor" });

    // byte-identical: a "setup" must never destroy a hand-edited config,
    // which is exactly what the old command did (it replaced it with {})
    expect(readFileSync(join(dir, "mcp.json"), "utf-8")).toBe(handEdited);
  });
});
