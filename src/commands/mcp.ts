import { existsSync, readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import { success, error, info, hint } from "../utils/display.js";
import { expandHome, ensureDir } from "../utils/file.js";
import { MCP_CONFIGS, MCP_MANIFEST_URL, DOCS_MCP_URL, MCP_DEFAULT_SLUGS } from "../constants.js";
import { getApiKey } from "../config.js";
import { join } from "node:path";

/**
 * `aisa mcp setup` — write real, per-client MCP entries from the live manifest.
 *
 * Three rules, each one a lesson from the version this replaces:
 *
 * 1. The server list comes from the platform's discovery manifest at setup
 *    time, never from this file. Servers ship without a CLI release.
 * 2. Nothing is written unless the manifest was actually fetched. The old
 *    command wrote first and verified never, which is how a dead hostname
 *    sat in users' configs across releases.
 * 3. Each client gets the shape it executes: `{url}` for clients that dial
 *    HTTP themselves, an `npx mcp-remote` stdio bridge for the ones that only
 *    spawn processes. One shape for all three was the old bug.
 *
 * Auth is a choice the user already made: with an API key configured, entries
 * carry it as a Bearer header (zero-interaction, but the key lands in each
 * client's config file); without one, entries carry no credentials and the
 * server's 401 challenge drives the client through the Clerk OAuth flow.
 */

export interface LiveServer {
  slug: string;
  name: string;
  endpoint: string;
  toolCount: number;
  /** One-paragraph capability description from the manifest — the single
   *  source of truth for what a server does; rendered on the connect page. */
  description: string;
  category: string;
}

export const stripped = (name: string) => name.replace(/^AIsa\s+/i, "");

export async function fetchLiveServers(): Promise<LiveServer[]> {
  const res = await fetch(MCP_MANIFEST_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`manifest answered HTTP ${res.status}`);
  const manifest = (await res.json()) as {
    servers?: Array<{
      slug?: string;
      name?: string;
      status?: string;
      transport?: { endpoint?: string };
      tools?: unknown[];
      description?: string;
      category?: string;
    }>;
  };
  const live = (manifest.servers ?? [])
    .filter((s) => s.status === "live" && s.slug && s.transport?.endpoint)
    .map((s) => ({
      slug: s.slug as string,
      name: s.name ?? (s.slug as string),
      endpoint: s.transport!.endpoint as string,
      toolCount: s.tools?.length ?? 0,
      description: s.description ?? "",
      category: s.category ?? "Other",
    }));
  if (live.length === 0) throw new Error("manifest lists no live servers");
  return live;
}

/** One config entry in the shape the client actually executes. */
export function buildEntry(
  shape: "url" | "stdio",
  endpoint: string,
  key: string | undefined
): Record<string, unknown> {
  if (shape === "url") {
    return key ? { url: endpoint, headers: { Authorization: `Bearer ${key}` } } : { url: endpoint };
  }
  // The exact invocation verified against production on 2026-08-18. The
  // header value splits on the first colon, so no space after "Authorization:".
  // Without a key, mcp-remote answers the server's 401 challenge by running
  // the OAuth flow itself and caching tokens under ~/.mcp-auth.
  const args = ["-y", "mcp-remote", endpoint];
  if (key) args.push("--header", `Authorization:Bearer ${key}`);
  args.push("--transport", "http-only");
  return { command: "npx", args };
}

/** The dead entry every pre-v0.3 setup wrote. Remove it on sight. */
const DEAD_URL = "https://docs.aisa.one/mcp";

export type WriteResult = { ok: true; written: number } | { ok: false; reason: string };

/**
 * Write the chosen servers (plus the docs server) into one client's config
 * file. Shared by `aisa mcp setup` and `aisa connect` so the two entry points
 * cannot drift in how they treat existing files: unparseable JSON is refused,
 * never replaced, and only the known-dead legacy entry is cleaned up.
 */
export function writeClientConfig(
  agent: string,
  chosen: LiveServer[],
  key: string | undefined
): WriteResult {
  const config = MCP_CONFIGS[agent];
  if (!config) return { ok: false, reason: `unknown client "${agent}"` };
  const filePath = expandHome(config.path);

  let existing: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // A file we cannot parse is a file we do not own. Refuse instead of
      // wiping a user's hand-edited config.
      return { ok: false, reason: `${config.path} exists but is not valid JSON` };
    }
  } else {
    ensureDir(join(filePath, ".."));
  }

  const entries = (existing[config.key] as Record<string, unknown>) || {};

  // Clean up the dead entry earlier releases wrote, and only that one: an
  // "aisa" entry the user pointed somewhere else on purpose stays.
  const stale = entries["aisa"] as { url?: string } | undefined;
  if (stale?.url === DEAD_URL) delete entries["aisa"];

  for (const s of chosen) {
    entries[`aisa-${s.slug}`] = buildEntry(config.shape, s.endpoint, key);
  }
  // The docs-search MCP is tiny, unauthenticated, and answers "how do I call
  // this" questions — always included.
  entries["aisa-docs"] = buildEntry(config.shape, DOCS_MCP_URL, undefined);

  existing[config.key] = entries;
  writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  return { ok: true, written: chosen.length + 1 };
}

export async function mcpSetupAction(options: { agent?: string; all?: boolean }): Promise<void> {
  const targets =
    options.agent && options.agent !== "all" ? [options.agent] : Object.keys(MCP_CONFIGS);

  for (const agent of targets) {
    if (!MCP_CONFIGS[agent]) {
      error(`Unknown agent: ${agent}. Valid: ${Object.keys(MCP_CONFIGS).join(", ")}, all`);
      return;
    }
  }

  // Fetch before touching any file: a setup that cannot see the manifest has
  // nothing true to write.
  let servers: LiveServer[];
  try {
    servers = await fetchLiveServers();
  } catch (e) {
    error(`Could not read the MCP manifest at ${MCP_MANIFEST_URL}: ${(e as Error).message}`);
    hint("Nothing was written. Check your network and try again.");
    process.exitCode = 1;
    return;
  }

  const chosen = options.all
    ? servers
    : servers.filter((s) => MCP_DEFAULT_SLUGS.includes(s.slug));
  const skipped = servers.length - chosen.length;

  const key = getApiKey();
  if (key) {
    info("Using your configured API key (Bearer). It will be written into each client's config file.");
  } else {
    info("No API key configured — entries are written without credentials, and the");
    info("server's OAuth flow will open in your browser on first use.");
  }

  for (const agent of targets) {
    const config = MCP_CONFIGS[agent];
    const result = writeClientConfig(agent, chosen, key);
    if (!result.ok) {
      error(`${agent}: ${result.reason} — refusing to overwrite it.`);
      hint("Fix or remove the file, then re-run setup.");
      continue;
    }
    console.log(
      `  ${chalk.green("✓")} ${agent}: ${result.written} servers (${config.shape}) → ${config.path}`
    );
  }

  success(`Configured ${chosen.length} live servers plus docs search for ${targets.length} client(s)`);
  for (const s of chosen) {
    console.log(`    ${chalk.cyan(`aisa-${s.slug}`)}  ${stripped(s.name)} (${s.toolCount} tools)`);
  }
  if (skipped > 0) hint(`${skipped} more live servers available — run with --all to configure every one`);
  hint("Restart your agent/editor to activate");
}

/**
 * `aisa mcp status` — what is configured, and does it actually answer.
 *
 * The old status only checked that a config file contained an "aisa" key,
 * which is exactly how a dead URL looked healthy. Reachability means a real
 * HTTP exchange with each configured endpoint.
 */
export async function mcpStatusAction(): Promise<void> {
  const endpoints = new Map<string, string[]>(); // endpoint -> [client/entry]

  for (const [agent, config] of Object.entries(MCP_CONFIGS)) {
    const filePath = expandHome(config.path);
    if (!existsSync(filePath)) {
      console.log(`  ${chalk.gray("○")} ${agent}: not installed`);
      continue;
    }
    let entries: Record<string, unknown> = {};
    try {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      entries = (data[config.key] as Record<string, unknown>) || {};
    } catch {
      console.log(`  ${chalk.gray("○")} ${agent}: config unreadable`);
      continue;
    }
    const ours = Object.entries(entries).filter(([name]) => name.startsWith("aisa"));
    if (ours.length === 0) {
      console.log(`  ${chalk.gray("○")} ${agent}: not configured`);
      continue;
    }
    console.log(`  ${chalk.green("✓")} ${agent}: ${ours.length} entries`);
    for (const [name, entry] of ours) {
      const e = entry as { url?: string; args?: string[] };
      const endpoint = e.url ?? e.args?.find((a) => a.startsWith("http"));
      if (endpoint) {
        const users = endpoints.get(endpoint) ?? [];
        users.push(`${agent}/${name}`);
        endpoints.set(endpoint, users);
      }
    }
  }

  if (endpoints.size === 0) {
    hint("Run 'aisa mcp setup' to configure");
    return;
  }

  console.log("");
  info("Checking each configured endpoint:");
  for (const [endpoint, users] of endpoints) {
    console.log(`  ${endpoint}  ${chalk.gray(`(${users.length} entr${users.length > 1 ? "ies" : "y"})`)}`);
    console.log(`    ${await pingEndpoint(endpoint)}`);
  }
}

/**
 * One initialize POST, no credentials. What each answer means:
 *   200 -> alive and open (the docs MCP)
 *   401 -> alive, auth required — the expected answer from mcp.aisa.one
 *   anything else -> alive but odd; say so
 *   network error -> the dead-hostname class this command exists to catch
 */
export async function pingEndpoint(endpoint: string): Promise<string> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "aisa-cli", version: "status" },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 200) return `${chalk.green("✓")} reachable (open)`;
    if (res.status === 401) return `${chalk.green("✓")} reachable (auth required — normal)`;
    return `${chalk.yellow("⚠")} reachable but answered HTTP ${res.status}`;
  } catch (e) {
    return `${chalk.red("✗")} unreachable: ${(e as Error).message}`;
  }
}
