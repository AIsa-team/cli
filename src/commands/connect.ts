import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { success, error, info, hint } from "../utils/display.js";
import { expandHome } from "../utils/file.js";
import { MCP_CONFIGS, MCP_DEFAULT_SLUGS } from "../constants.js";
import { getApiKey } from "../config.js";
import { fetchLiveServers, writeClientConfig, stripped, type LiveServer } from "./mcp.js";

/**
 * `aisa connect` — a one-shot local web page that wires AIsa's MCP servers
 * into the coding agents installed on this machine.
 *
 * The shape is deliberate, learned from studying how others solve "install an
 * MCP from a web page":
 *
 * - A remote page cannot touch the local machine, and Claude Code has no
 *   install deeplink (Cursor and VS Code do). The only bridge that works for
 *   every client is a local process serving a page on 127.0.0.1 — so that is
 *   all this is.
 * - It is a *visitor*, not a resident: pick servers, pick clients, apply,
 *   sign in, exit. No daemon, no terminal takeover, no prompt or skill
 *   injection into the user's agent. The user stays in their own Claude Code.
 * - Sign-in is the platform's own OAuth, driven through each client's own
 *   machinery: after the entries are added, `claude mcp login <name>` is run
 *   per server — Claude Code opens the browser authorization (Clerk), and
 *   the tokens land in Claude Code's own store, where Claude Code refreshes
 *   them. No API key, nothing pasted, nothing for us to store or expire.
 *   File-based clients (mcp-remote bridges) run the same OAuth themselves on
 *   first use. A configured `aisa` API key short-circuits all of it (entries
 *   carry it as a Bearer header and no login is needed).
 * - The page reports the whole journey live (GET /status polling), and a
 *   dedicated success page opens at the end — spawned by this process via
 *   the OS browser command, so no popup blocker is involved — because users
 *   who tabbed away to the authorization rarely come back to the first tab.
 *
 * Page style matches the AIsa Console sign-in (auth.aisa.one, tokens read
 * off the live page 2026-08-20): warm #f9f8f6 dot-grid background, black
 * #0d0d0b top bar, Inter with 800-weight headlines, #e5322d headline red,
 * #cc2b26 CTA red at 6px radius. Capability groups follow the pattern of
 * Sentry's OAuth approval screen: checkbox + name + tool-count badge + a
 * real description of what the capability gives the agent.
 */

const execFileP = promisify(execFile);

/** How long the page may sit untouched before we give up and exit. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** How long the success page stays served before the process exits. Copy
 *  buttons are client-side, so the page keeps working after exit. */
const LINGER_AFTER_DONE_MS = 5 * 60 * 1000;

// ── brand tokens (auth.aisa.one, read live) ─────────────────────────────────
const RED = "#e5322d";
const RED_CTA = "#cc2b26";
const INK = "#0d0d0b";
const PAPER = "#f9f8f6";

// ── inline icons (lucide, 18px, currentColor — icon-kit) ────────────────────
const I = {
  search: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m21 21l-4.34-4.34"/><circle cx="11" cy="11" r="8"/></g></svg>`,
  finance: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 7h6v6"/><path d="m22 7l-8.5 8.5l-5-5L2 17"/></g></svg>`,
  social: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></g></svg>`,
  sales: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></g></svg>`,
  terminal: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19h8M4 17l6-6l-6-6"/></svg>`,
  shield: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12l2 2l4-4"/></g></svg>`,
  check: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"/></svg>`,
  copy: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></g></svg>`,
  arrow: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14m-7-7l7 7l-7 7"/></svg>`,
  sparkles: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/></g></svg>`,
  hexagon: `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="#f26522" d="M12 1.5 21.1 6.75v10.5L12 22.5 2.9 17.25V6.75z"/><path fill="#f9f8f6" d="M12 6.2 16.9 9v6L12 17.8 7.1 15V9z"/><path fill="#f26522" d="M12 9.4 14.3 10.7v2.6L12 14.6 9.7 13.3v-2.6z"/></svg>`,
} as const;

const CATEGORY_ICON: Record<string, string> = {
  "Search & Research": I.search,
  Search: I.search,
  Finance: I.finance,
  Social: I.social,
  Sales: I.sales,
};

/**
 * One try-it-now prompt per server, shown on the success page for what the
 * user actually installed. Every prompt names the `aisa-<slug>` server
 * explicitly — the one phrasing that reliably routes to our MCP instead of
 * whatever other search/social tool the agent also has.
 */
const EXAMPLES: Record<string, string> = {
  "web-search":
    "Use the aisa-web-search MCP tools to search the web for this week's biggest AI news and summarize the top 3 results with links.",
  "twitter-api":
    "Use the aisa-twitter-api MCP tools to fetch the latest tweets from @AnthropicAI and summarize the main themes.",
  "crypto-market-data":
    "Use the aisa-crypto-market-data MCP tools to get Bitcoin's current price and 24h change, then compare it with Ethereum.",
  marketpulse:
    "Use the aisa-marketpulse MCP tools to pull AAPL's latest income statement and summarize the revenue and margin trend.",
  "stock-pulse":
    "Use the aisa-stock-pulse MCP tools to show what X/Twitter is saying about NVDA today, joined with its market data.",
  "prediction-market-data":
    "Use the aisa-prediction-market-data MCP tools to list the most active prediction markets right now with their implied probabilities.",
  reddit:
    "Use the aisa-reddit MCP tools to find today's top posts in r/MachineLearning and summarize the discussion.",
  "youtube-search":
    "Use the aisa-youtube-search MCP tools to find the three most relevant videos about MCP servers and list their channels.",
  instagram:
    "Use the aisa-instagram MCP tools to fetch the profile and recent posts of @nasa and describe their content strategy.",
  pinterest:
    "Use the aisa-pinterest MCP tools to search pins for 'mid-century interior' and summarize the visual trends.",
  apollo:
    "Use the aisa-apollo MCP tools to enrich the company anthropic.com — size, industry, and key people.",
};

interface ClientInfo {
  id: string;
  label: string;
  kind: "cli" | "file" | "soon";
  detected: boolean;
  detail: string;
}

const FILE_CLIENT_LABELS: Record<string, string> = {
  cursor: "Cursor",
  "claude-desktop": "Claude Desktop",
  windsurf: "Windsurf",
};

export function detectClients(): ClientInfo[] {
  const clients: ClientInfo[] = [];

  // Claude Code: presence means the `claude` binary answers on PATH. Its MCP
  // entries live in user scope managed by the binary itself, not in a config
  // file we own — hence kind "cli".
  const probe = spawnSync("claude", ["--version"], { timeout: 5_000, encoding: "utf8" });
  const claudeVersion = probe.status === 0 ? probe.stdout.trim() : "";
  clients.push({
    id: "claude-code",
    label: "Claude Code",
    kind: "cli",
    detected: probe.status === 0,
    detail: claudeVersion || "claude not found on PATH",
  });

  for (const [id, cfg] of Object.entries(MCP_CONFIGS)) {
    // "Installed" here means the client's config directory exists. Coarse,
    // but the false-positive cost is one harmless config file.
    const detected = existsSync(dirname(expandHome(cfg.path)));
    clients.push({
      id,
      label: FILE_CLIENT_LABELS[id] ?? id,
      kind: "file",
      detected,
      detail: cfg.path,
    });
  }

  // Codex: shown for the roadmap's sake (its config is TOML and its OAuth
  // story differs), never selectable until real support lands. An honest
  // label beats a checkbox that writes a config Codex cannot read.
  const codex = spawnSync("codex", ["--version"], { timeout: 5_000, encoding: "utf8" });
  clients.push({
    id: "codex",
    label: "Codex",
    kind: "soon",
    detected: false,
    detail: codex.status === 0 ? "detected — support coming soon" : "support coming soon",
  });

  return clients;
}

/**
 * Configure one server entry in Claude Code's user scope. Remove-then-add
 * because `claude mcp add` refuses to overwrite an existing name; removing a
 * name that is not there fails too, which is exactly why that failure is
 * ignored. The result is idempotent either way.
 */
async function claudeCodeAdd(name: string, endpoint: string, key: string | undefined): Promise<void> {
  await execFileP("claude", ["mcp", "remove", "-s", "user", name], { timeout: 15_000 }).catch(
    () => {}
  );
  const args = ["mcp", "add", "-s", "user", "--transport", "http", name, endpoint];
  if (key) args.push("--header", `Authorization: Bearer ${key}`);
  await execFileP("claude", args, { timeout: 15_000 });
}

/**
 * Drive Claude Code's own OAuth for one server: `claude mcp login` opens the
 * browser authorization and stores the tokens in Claude Code's own store,
 * where Claude Code also refreshes them. stdio is inherited on purpose — the
 * login needs the user's real terminal (it prompts on stdin as a headless
 * fallback), and its progress lines belong in front of the user.
 */
function claudeCodeLogin(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["mcp", "login", name], { stdio: "inherit" });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 180_000);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

interface ApplyResult {
  client: string;
  ok: boolean;
  message: string;
}

async function applySelection(
  clientIds: string[],
  chosen: LiveServer[],
  key: string | undefined,
  dryRun: boolean
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const id of clientIds) {
    if (id === "claude-code") {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would run claude mcp add for ${chosen.length} servers` });
        continue;
      }
      try {
        for (const s of chosen) {
          await claudeCodeAdd(`aisa-${s.slug}`, s.endpoint, key);
        }
        results.push({
          client: id,
          ok: true,
          message: `${chosen.length} servers added (user scope)${key ? "" : " — browser authorization starts next"}`,
        });
      } catch (e) {
        results.push({ client: id, ok: false, message: (e as Error).message });
      }
    } else if (MCP_CONFIGS[id]) {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would write ${chosen.length + 1} entries to ${MCP_CONFIGS[id].path}` });
        continue;
      }
      const r = writeClientConfig(id, chosen, key);
      results.push(
        r.ok
          ? { client: id, ok: true, message: `${r.written} servers → ${MCP_CONFIGS[id].path}` }
          : { client: id, ok: false, message: r.reason }
      );
    } else {
      results.push({ client: id, ok: false, message: "unknown client" });
    }
  }
  return results;
}

// ── live run state, served at /status for the page to poll ─────────────────
type AuthState = "pending" | "authorizing" | "ok" | "fail";
interface RunState {
  phase: "selecting" | "applying" | "authorizing" | "done" | "failed";
  results: ApplyResult[];
  auth: Record<string, AuthState>; // key: aisa-<slug>
  doneUrl?: string;
}

// ── shared page shell (brand: auth.aisa.one) ────────────────────────────────
function shell(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --paper: ${PAPER}; --ink: #1c1b1a; --muted: #6d6a66; --line: #e7e4df;
    --card: #ffffff; --red: ${RED}; --red-cta: ${RED_CTA}; --bar: ${INK};
    --tint: #fdf1ef; --ok: #2e7d43;
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #141312; --ink: #f0eeeb; --muted: #9b9792; --line: #2c2a27;
            --card: #1d1c1a; --tint: #2a1917; --ok: #57b06f; }
  }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--paper); color: var(--ink);
    font: 15px/1.55 Inter, "Inter Fallback", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
    background-image: radial-gradient(color-mix(in srgb, var(--muted) 22%, transparent) 1px, transparent 1px);
    background-size: 22px 22px; }
  .bar { background: var(--bar); color: #fff; display: flex; align-items: center;
    gap: .55rem; padding: .8rem 1.4rem; font-weight: 600; }
  .bar .ai { color: #f26522; font-weight: 800; } .bar .sa { color: #fff; font-weight: 800; }
  .bar .tag { margin-left: .4rem; font-weight: 400; opacity: .55; font-size: .85rem; }
  .bar .local { margin-left: auto; font-weight: 400; font-size: .78rem; opacity: .5; }
  main { max-width: 46rem; margin: 0 auto; padding: 2.6rem 1.4rem 4rem; }
  .eyebrow { display: flex; align-items: center; gap: .55rem; color: var(--muted);
    font-size: .74rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
  .eyebrow::before { content: ""; width: 26px; height: 3px; background: var(--red); }
  h1 { font-size: 2.1rem; font-weight: 800; letter-spacing: -.02em; margin: .55rem 0 .5rem; }
  h1 em { font-style: normal; color: var(--red); }
  .lede { color: var(--muted); max-width: 38rem; }
  h2 { display: flex; align-items: center; gap: .5rem; font-size: .95rem; font-weight: 700;
    margin: 2.2rem 0 .8rem; }
  h2 .n { display: inline-flex; align-items: center; justify-content: center; width: 22px;
    height: 22px; border-radius: 50%; background: var(--red); color: #fff; font-size: .75rem; }
  .cat { display: flex; align-items: center; gap: .45rem; color: var(--muted);
    font-size: .74rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
    margin: 1.1rem 0 .45rem; }
  .cat svg { width: 15px; height: 15px; }
  .card { display: flex; gap: .8rem; align-items: flex-start; background: var(--card);
    border: 1px solid var(--line); border-left: 3px solid var(--line); border-radius: 8px;
    padding: .85rem .95rem; margin-bottom: .55rem; cursor: pointer; transition: border-color .15s; }
  .card:hover { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
  .card.on { border-left-color: var(--red); background: color-mix(in srgb, var(--tint) 55%, var(--card)); }
  .card.off { opacity: .55; cursor: default; }
  .card input { width: 18px; height: 18px; margin-top: .15rem; accent-color: var(--red-cta); flex: none; }
  .card .body { min-width: 0; }
  .card .head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .card .name { font-weight: 700; }
  .badge { font-size: .7rem; font-weight: 600; padding: .1rem .5rem; border-radius: 99px;
    border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .badge.ok { border-color: color-mix(in srgb, var(--ok) 55%, transparent); color: var(--ok); }
  .card .desc { color: var(--muted); font-size: .86rem; margin-top: .25rem; }
  .authnote { display: flex; gap: .7rem; align-items: flex-start; background: var(--card);
    border: 1px solid var(--line); border-radius: 8px; padding: .9rem 1rem; color: var(--muted);
    font-size: .88rem; }
  .authnote svg { flex: none; margin-top: .1rem; color: var(--red); }
  .authnote b { color: var(--ink); }
  .cta { display: inline-flex; align-items: center; gap: .6rem; margin-top: 1.8rem;
    background: var(--red-cta); color: #fff; border: none; border-radius: 6px;
    font: inherit; font-weight: 600; font-size: 1.02rem; padding: .8rem 2.2rem; cursor: pointer; }
  .cta:hover { background: color-mix(in srgb, var(--red-cta) 88%, black); }
  .cta:disabled { opacity: .55; cursor: default; }
  .fine { color: var(--muted); font-size: .8rem; margin-top: .8rem; }
  #progress { margin-top: 1.6rem; display: none; }
  .step { display: flex; align-items: center; gap: .6rem; padding: .5rem .2rem;
    border-bottom: 1px dashed var(--line); font-size: .92rem; }
  .step .st { margin-left: auto; font-size: .8rem; font-weight: 600; color: var(--muted); }
  .step.ok .st { color: var(--ok); } .step.fail .st { color: var(--red); }
  .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--line);
    border-top-color: var(--red); border-radius: 50%; animation: r 1s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .bigcheck { width: 64px; height: 64px; border-radius: 50%; background: var(--red);
    color: #fff; display: flex; align-items: center; justify-content: center; margin-bottom: 1.2rem; }
  .bigcheck svg { width: 34px; height: 34px; }
  .example { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: .9rem 1rem; margin-bottom: .6rem; display: flex; gap: .8rem; align-items: flex-start; }
  .example .txt { font-size: .9rem; }
  .example .srv { color: var(--red); font-weight: 600; font-size: .74rem; letter-spacing: .06em;
    text-transform: uppercase; display: block; margin-bottom: .25rem; }
  .example button { margin-left: auto; flex: none; display: inline-flex; align-items: center;
    gap: .35rem; font: inherit; font-size: .8rem; font-weight: 600; color: var(--ink);
    background: transparent; border: 1px solid var(--line); border-radius: 6px;
    padding: .35rem .7rem; cursor: pointer; }
  .example button:hover { border-color: var(--red); color: var(--red); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em;
    background: color-mix(in srgb, var(--muted) 12%, transparent); padding: .1em .35em;
    border-radius: 4px; }
</style></head><body>
<div class="bar">${I.hexagon}<span><span class="ai">AI</span><span class="sa">sa</span></span>
<span class="tag">MCP Connect</span><span class="local">local · 127.0.0.1</span></div>
<main>${body}</main>
</body></html>`;
}

// ── page A: selection + live progress ───────────────────────────────────────
function renderPage(servers: LiveServer[], clients: ClientInfo[], token: string, keyed: boolean): string {
  const byCategory = new Map<string, LiveServer[]>();
  for (const s of servers) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }
  const serverGroups = [...byCategory.entries()]
    .map(([cat, list]) => {
      const rows = list
        .map((s) => {
          const checked = MCP_DEFAULT_SLUGS.includes(s.slug) ? "checked" : "";
          return `<label class="card ${checked ? "on" : ""}" data-kind="server">
  <input type="checkbox" name="server" value="${s.slug}" ${checked}>
  <span class="body"><span class="head"><span class="name">${stripped(s.name)}</span>
    <span class="badge">${s.toolCount} tools</span></span>
    <span class="desc">${s.description}</span></span></label>`;
        })
        .join("\n");
      return `<div class="cat">${CATEGORY_ICON[cat] ?? I.sparkles}${cat}</div>\n${rows}`;
    })
    .join("\n");

  const clientRows = clients
    .map((c) => {
      const soon = c.kind === "soon";
      const usable = c.detected && !soon;
      const badge = soon
        ? `<span class="badge">coming soon</span>`
        : c.detected
          ? `<span class="badge ok">detected</span>`
          : `<span class="badge">not found</span>`;
      return `<label class="card ${usable ? "on" : "off"}" data-kind="client">
  <input type="checkbox" name="client" value="${c.id}" ${usable ? "checked" : "disabled"}>
  <span class="body"><span class="head"><span class="name">${c.label}</span>${badge}</span>
    <span class="desc">${c.detail}</span></span></label>`;
    })
    .join("\n");

  const totalTools = servers.reduce((n, s) => n + s.toolCount, 0);
  const authCopy = keyed
    ? `Your configured AIsa API key is written into each entry — <b>no sign-in needed</b>.`
    : `<b>No API keys, nothing to paste.</b> After you press Connect, your browser opens the
       AIsa authorization once per server. Approve each one; Claude Code keeps and refreshes
       the tokens itself. Other clients sign in the same way on their first call.`;

  const body = `
<div class="eyebrow">Connect</div>
<h1>Give your agent <em>real-world reach</em></h1>
<p class="lede">One connection puts <b>${totalTools} live tools</b> — web search &amp; research,
X/Twitter, Reddit, Instagram, stocks, crypto, prediction markets and B2B data — inside the
coding agent you already use. Pick what you need, press Connect, approve in the browser. Done.</p>

<h2><span class="n">1</span>Choose capabilities</h2>
${serverGroups}

<h2><span class="n">2</span>Install into</h2>
${clientRows}

<h2><span class="n">3</span>Authorize</h2>
<div class="authnote">${I.shield}<div>${authCopy}</div></div>

<button class="cta" id="apply">Connect ${I.arrow}</button>
<p class="fine">Served by the local <code>aisa connect</code> process — nothing leaves your
machine except the OAuth you approve. The process exits when everything is connected.</p>

<div id="progress"></div>
<div id="result" class="fine"></div>

<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var btn = document.getElementById("apply");
  var progress = document.getElementById("progress");
  var result = document.getElementById("result");

  document.querySelectorAll(".card input").forEach(function (cb) {
    cb.addEventListener("change", function () {
      cb.closest(".card").classList.toggle("on", cb.checked);
    });
  });

  function picked(name) {
    return Array.prototype.map.call(
      document.querySelectorAll('input[name="' + name + '"]:checked'),
      function (i) { return i.value; });
  }

  function renderAuth(auth) {
    var names = Object.keys(auth);
    if (!names.length) return;
    progress.style.display = "block";
    progress.innerHTML = "<h2><span class='n'>4</span>Authorizing</h2>" + names.map(function (n) {
      var st = auth[n];
      var cls = st === "ok" ? "ok" : st === "fail" ? "fail" : "";
      var label = st === "ok" ? "authorized" : st === "fail" ? "failed — retry: claude mcp login " + n
        : st === "authorizing" ? "<span class='spin'></span>" : "waiting";
      return "<div class='step " + cls + "'><span>" + n + "</span><span class='st'>" + label + "</span></div>";
    }).join("");
  }

  function poll() {
    fetch("/status?token=" + TOKEN).then(function (r) { return r.json(); }).then(function (s) {
      renderAuth(s.auth || {});
      if (s.phase === "done") {
        document.title = "\\u2713 AIsa Connected";
        result.innerHTML = "<b>All connected.</b> A success page with try-it-now examples just opened in a new tab.";
        btn.textContent = "Connected";
        return;
      }
      if (s.phase === "failed") {
        result.innerHTML = "Some servers were not authorized — see the list above, retry from your terminal.";
        return;
      }
      setTimeout(poll, 1000);
    }).catch(function () { setTimeout(poll, 1500); });
  }

  btn.addEventListener("click", function () {
    var servers = picked("server"), clients = picked("client");
    if (!servers.length || !clients.length) {
      result.textContent = "Pick at least one capability and one client."; return;
    }
    btn.disabled = true; btn.textContent = "Connecting\\u2026";
    fetch("/apply", { method: "POST",
      headers: { "content-type": "application/json", "x-connect-token": TOKEN },
      body: JSON.stringify({ servers: servers, clients: clients })
    }).then(function (r) { return r.json(); }).then(function (data) {
      result.innerHTML = data.results.map(function (r) {
        return (r.ok ? "\\u2713 " : "\\u2717 ") + r.client + ": " + r.message;
      }).join("<br>");
      if (data.authNext) { poll(); }
      else if (data.done) {
        document.title = "\\u2713 AIsa Connected";
        result.innerHTML += "<br><b>All set.</b> A success page just opened in a new tab.";
        btn.textContent = "Connected";
      } else { btn.disabled = false; btn.textContent = "Retry"; }
    });
  });
})();
</script>`;
  return shell("AIsa Connect", body);
}

// ── page C: success + try-it-now examples ───────────────────────────────────
function renderDone(chosen: LiveServer[], clientIds: string[], failures: string[]): string {
  const clientNames = clientIds
    .map((id) => (id === "claude-code" ? "Claude Code" : FILE_CLIENT_LABELS[id] ?? id))
    .join(", ");
  const examples = chosen
    .filter((s) => EXAMPLES[s.slug])
    .slice(0, 3)
    .map(
      (s) => `<div class="example"><div><span class="srv">aisa-${s.slug}</span>
<div class="txt">${EXAMPLES[s.slug]}</div></div>
<button data-copy="${EXAMPLES[s.slug].replace(/"/g, "&quot;")}">${I.copy} Copy</button></div>`
    )
    .join("\n");
  const failBlock = failures.length
    ? `<div class="authnote" style="margin-bottom:1.2rem">${I.shield}<div>
       <b>${failures.length} server(s) were not authorized:</b> ${failures.join(", ")}.
       Retry from your terminal with <code>claude mcp login &lt;name&gt;</code>.</div></div>`
    : "";

  const body = `
<div class="bigcheck">${I.check}</div>
<div class="eyebrow">Connected</div>
<h1>Your agent just got <em>${chosen.reduce((n, s) => n + s.toolCount, 0)} new tools</em></h1>
<p class="lede">${chosen.length} AIsa MCP server${chosen.length > 1 ? "s are" : " is"} now
installed and authorized in <b>${clientNames}</b>. Tokens live in your client and refresh
automatically — nothing else to configure.</p>
${failBlock}
<h2>${I.sparkles} Try it now — paste one of these into ${clientNames.split(",")[0]}</h2>
${examples || '<p class="fine">Ask your agent to use any of the aisa-* MCP tools.</p>'}
<p class="fine">Each prompt names its <code>aisa-*</code> server explicitly, so the request
routes to AIsa instead of any other tool your agent has. Verify anytime with <code>/mcp</code>
inside Claude Code — the entries should show <b>Connected</b>.</p>
<p class="fine">This page keeps working after the local process exits.</p>
<script>
document.querySelectorAll("[data-copy]").forEach(function (b) {
  b.addEventListener("click", function () {
    navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () {
      b.textContent = "Copied \\u2713"; setTimeout(function () { b.innerHTML = ${JSON.stringify(I.copy + " Copy")}; }, 1600);
    });
  });
});
</script>`;
  return shell("✓ AIsa Connected", body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url], () => {});
}

export async function connectAction(options: {
  open?: boolean;
  port?: string;
  dryRun?: boolean;
}): Promise<void> {
  let servers: LiveServer[];
  try {
    servers = await fetchLiveServers();
  } catch (e) {
    error(`Could not read the MCP manifest: ${(e as Error).message}`);
    hint("Check your network and try again.");
    process.exitCode = 1;
    return;
  }
  const clients = detectClients();
  const detected = clients.filter((c) => c.detected && c.kind !== "soon");
  if (detected.length === 0) {
    error("No supported client found (Claude Code, Cursor, Claude Desktop, Windsurf).");
    hint("Install one, or use 'aisa mcp setup --agent <client>' to write a config anyway.");
    process.exitCode = 1;
    return;
  }
  const key = getApiKey();

  // One random token per run: the page and every endpoint require it, so
  // another local process cannot drive this server blind.
  const token = randomBytes(16).toString("hex");
  const page = renderPage(servers, clients, token, Boolean(key));

  const state: RunState = { phase: "selecting", results: [], auth: {} };
  let chosenServers: LiveServer[] = [];
  let chosenClients: string[] = [];
  let port = 0;

  let settled = false;
  const idle = setTimeout(() => {
    if (settled) return;
    error("No response from the browser in 10 minutes — giving up.");
    process.exit(1);
  }, IDLE_TIMEOUT_MS);

  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const tokenOk =
      url.searchParams.get("token") === token || req.headers["x-connect-token"] === token;

    if (req.method === "GET" && url.pathname === "/") {
      if (!tokenOk) {
        res.writeHead(403).end("forbidden");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
      return;
    }
    if (req.method === "GET" && url.pathname === "/done") {
      if (!tokenOk) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const failures = Object.entries(state.auth)
        .filter(([, st]) => st === "fail")
        .map(([n]) => n);
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(renderDone(chosenServers, chosenClients, failures));
      return;
    }
    if (req.method === "POST" && url.pathname === "/apply") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      let body: { servers?: string[]; clients?: string[] };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400).end();
        return;
      }
      chosenServers = servers.filter((s) => body.servers?.includes(s.slug));
      chosenClients = body.clients ?? [];
      state.phase = "applying";

      const results = await applySelection(chosenClients, chosenServers, key, Boolean(options.dryRun));
      state.results = results;
      const done = results.length > 0 && results.every((r) => r.ok);
      // Entries added for Claude Code without a key still need tokens; that
      // is the login pass below, announced to the page via authNext.
      const authNext =
        done &&
        !options.dryRun &&
        !key &&
        chosenClients.includes("claude-code") &&
        chosenServers.length > 0;
      if (authNext) {
        for (const s of chosenServers) state.auth[`aisa-${s.slug}`] = "pending";
        state.phase = "authorizing";
      }
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ results, done, authNext }));

      for (const r of results) {
        const mark = r.ok ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${mark} ${r.client}: ${r.message}`);
      }
      if (done && !settled) {
        settled = true;
        clearTimeout(idle);
        let authFailures = 0;
        if (authNext) {
          // The platform's own OAuth, through Claude Code's own machinery:
          // one browser authorization per server, tokens stored and refreshed
          // by Claude Code. Sequential on purpose — parallel logins would
          // race the browser with several consent tabs at once.
          info("Starting browser authorization for each server…");
          for (const s of chosenServers) {
            const name = `aisa-${s.slug}`;
            state.auth[name] = "authorizing";
            const ok = await claudeCodeLogin(name);
            state.auth[name] = ok ? "ok" : "fail";
            if (!ok) authFailures++;
            console.log(
              `  ${ok ? chalk.green("✓") : chalk.red("✗")} ${name}: ${ok ? "authorized" : "authorization failed or timed out"}`
            );
          }
        }
        state.phase = authFailures > 0 ? "failed" : "done";
        if (authFailures > 0) {
          error(`${authFailures} server(s) not authorized — run 'claude mcp login <name>' to retry.`);
        }
        success(
          options.dryRun
            ? "Dry run complete — nothing was written."
            : `Connected and authorized ${chosenServers.length} server(s) for ${results.length} client(s)`
        );
        if (!options.dryRun) {
          // The success page opens as a fresh tab from this process (an OS
          // browser launch, so no popup blocker applies) — users who tabbed
          // away to the authorization rarely come back to the first tab.
          const doneUrl = `http://127.0.0.1:${port}/done?token=${token}`;
          state.doneUrl = doneUrl;
          openBrowser(doneUrl);
          hint("A success page with try-it-now examples just opened in your browser");
          hint("Verify anytime with /mcp inside Claude Code — entries should show Connected");
          info("Keeping the success page alive for 5 minutes (Ctrl-C to finish now)…");
          setTimeout(() => {
            srv.close();
            process.exit(authFailures > 0 ? 1 : 0);
          }, LINGER_AFTER_DONE_MS);
        } else {
          setTimeout(() => {
            srv.close();
            process.exit(0);
          }, 300);
        }
      }
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    srv.listen(options.port ? Number(options.port) : 0, "127.0.0.1", resolve);
  });
  const addr = srv.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  const pageUrl = `http://127.0.0.1:${port}/?token=${token}`;

  info(
    `${servers.length} live servers · detected: ${detected.map((c) => c.label).join(", ")}`
  );
  console.log(`  ${chalk.cyan(pageUrl)}`);
  if (options.open === false) {
    hint("Open the URL above in your browser to continue (Ctrl-C to cancel)");
  } else {
    info("Opening your browser… (Ctrl-C to cancel)");
    openBrowser(pageUrl);
  }
}
