import { execFile, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import chalk from "chalk";
import { success, error, info, hint } from "../utils/display.js";
import { expandHome } from "../utils/file.js";
import { MCP_CONFIGS, MCP_DEFAULT_SLUGS } from "../constants.js";
import { getApiKey, setApiKey } from "../config.js";
import { apiRequest } from "../api.js";
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
 *   exit. No daemon, no terminal takeover, no prompt or skill injection into
 *   the user's agent. The user stays in their own Claude Code.
 * - Sign-in happens in the same visit when possible: the page links to the
 *   Console's api-keys page and takes a paste, which is validated against the
 *   platform, stored for the CLI, and written into every entry — the agents
 *   are authenticated from their first call. Left empty, entries are keyless
 *   and each client's 401 challenge drives OAuth on first use instead. (A
 *   true browser→loopback key handoff needs a Console endpoint that does not
 *   exist yet; see CONSOLE_KEYS_URL.)
 *
 * Claude Code is configured through its own CLI (`claude mcp add`) because
 * its user-scope config is not a file we should edit; every other client is
 * a JSON file write shared with `aisa mcp setup` via writeClientConfig.
 */

const execFileP = promisify(execFile);

/** How long the page may sit untouched before we give up and exit. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface ClientInfo {
  id: string;
  label: string;
  kind: "cli" | "file";
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

interface ApplyResult {
  client: string;
  ok: boolean;
  message: string;
}

/** Where a key is minted today. A true browser→loopback key handoff needs a
 *  Console endpoint the platform does not have yet; until then the page links
 *  here and takes a paste. */
export const CONSOLE_KEYS_URL = "https://console.aisa.one/api-keys";

/**
 * A pasted key is checked against the platform's `credits/balance` (free,
 * properly authenticated) before anything is written with it. The MCP
 * endpoints themselves are useless for this — probed 2026-08-19, their
 * `initialize` answers 200 for ANY Bearer value and only 401s when the
 * header is absent entirely, so token authenticity is never checked there.
 * A definite 401/403 damns the key; a flaky network must not eat the
 * user's paste, so anything else counts as "accept and move on".
 */
async function validateKey(key: string): Promise<"ok" | "bad" | "unknown"> {
  try {
    const res = await apiRequest(key, "credits/balance");
    if (res.success) return "ok";
    if (/^40[13]:/.test(res.error ?? "")) return "bad";
    return "unknown";
  } catch {
    return "unknown";
  }
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
          message: `${chosen.length} servers added (user scope) — run /mcp inside Claude Code to see them`,
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

/** The selection page. Self-contained: inline CSS/JS, no external assets. */
function renderPage(servers: LiveServer[], clients: ClientInfo[], token: string, keyed: boolean): string {
  const serverRows = servers
    .map((s) => {
      const checked = MCP_DEFAULT_SLUGS.includes(s.slug) ? "checked" : "";
      return `<label class="row"><input type="checkbox" name="server" value="${s.slug}" ${checked}>
        <span class="name">${stripped(s.name)}</span>
        <span class="meta">${s.toolCount} tools</span></label>`;
    })
    .join("\n");
  const clientRows = clients
    .map((c) => {
      const checked = c.detected ? "checked" : "";
      const badge = c.detected
        ? `<span class="badge ok">detected</span>`
        : `<span class="badge">not found</span>`;
      return `<label class="row"><input type="checkbox" name="client" value="${c.id}" ${checked} ${c.detected ? "" : "disabled"}>
        <span class="name">${c.label}</span>${badge}
        <span class="meta">${c.detail}</span></label>`;
    })
    .join("\n");
  const authSection = keyed
    ? ""
    : `<h2>Sign in</h2>
<p class="note" style="margin-top:.2rem">Grab a key from
<a href="${CONSOLE_KEYS_URL}" target="_blank" rel="noopener">console.aisa.one/api-keys</a>
(opens in a new tab) and paste it here. It is checked against a live server,
stored for the <code>aisa</code> CLI, and written into each entry — so your
agents are signed in from the first call.<br>
Leave it empty to stay keyless: each client then opens the AIsa sign-in on first use.</p>
<input type="password" id="apikey" placeholder="aisa-..." autocomplete="off"
  style="width:100%;font:inherit;padding:.5rem .6rem;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent">`;
  const authNote = keyed
    ? "Using your configured AIsa API key."
    : "This page is served by the local <code>aisa connect</code> process; the key goes to 127.0.0.1 only.";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>AIsa Connect</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; max-width: 40rem;
         margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 1.3rem; } h1 span { opacity:.5; font-weight: 400; }
  h2 { font-size: .8rem; text-transform: uppercase; letter-spacing:.08em; opacity:.6; margin: 1.8rem 0 .4rem; }
  .row { display: flex; gap: .6rem; align-items: baseline; padding: .35rem .5rem;
         border-radius: 6px; cursor: pointer; }
  .row:hover { background: rgba(128,128,128,.12); }
  .name { font-weight: 500; }
  .meta { margin-left: auto; opacity: .55; font-size: .82rem; }
  .badge { font-size: .7rem; padding: .05rem .45rem; border-radius: 99px;
           border: 1px solid rgba(128,128,128,.4); opacity: .7; }
  .badge.ok { border-color: #34a058; color: #34a058; opacity: 1; }
  button { margin-top: 1.6rem; font: inherit; font-weight: 600; padding: .55rem 1.4rem;
           border-radius: 8px; border: none; background: #1a73e8; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .note { opacity: .6; font-size: .82rem; margin-top: .8rem; }
  #result { margin-top: 1.4rem; white-space: pre-wrap; font-family: ui-monospace, monospace;
            font-size: .85rem; }
</style></head><body>
<h1>AIsa Connect <span>· pick servers, pick agents, done</span></h1>
<h2>MCP servers</h2>
${serverRows}
<h2>Install into</h2>
${clientRows}
${authSection}
<button id="apply">Connect</button>
<p class="note">${authNote}<br>This page shuts down when finished.</p>
<div id="result"></div>
<script>
const btn = document.getElementById("apply");
btn.addEventListener("click", async () => {
  const picked = (name) => [...document.querySelectorAll('input[name="'+name+'"]:checked')].map(i => i.value);
  const servers = picked("server"), clients = picked("client");
  const out = document.getElementById("result");
  if (!servers.length || !clients.length) { out.textContent = "Pick at least one server and one client."; return; }
  const keyInput = document.getElementById("apikey");
  const apiKey = keyInput ? keyInput.value.trim() : "";
  btn.disabled = true; btn.textContent = "Connecting…";
  const res = await fetch("/apply", { method: "POST",
    headers: { "content-type": "application/json", "x-connect-token": ${JSON.stringify(token)} },
    body: JSON.stringify({ servers, clients, apiKey: apiKey || undefined }) });
  const data = await res.json();
  out.textContent = data.results.map(r => (r.ok ? "✓ " : "✗ ") + r.client + ": " + r.message).join("\\n");
  if (data.done) {
    out.textContent += "\\n\\nAll set — restart your agent (or run /mcp in Claude Code). You can close this tab.";
    btn.textContent = "Done";
  } else { btn.disabled = false; btn.textContent = "Retry"; }
});
</script></body></html>`;
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
  const detected = clients.filter((c) => c.detected);
  if (detected.length === 0) {
    error("No supported client found (Claude Code, Cursor, Claude Desktop, Windsurf).");
    hint("Install one, or use 'aisa mcp setup --agent <client>' to write a config anyway.");
    process.exitCode = 1;
    return;
  }
  const key = getApiKey();

  // One random token per run: the page and the apply endpoint both require
  // it, so another local process cannot drive this server blind.
  const token = randomBytes(16).toString("hex");
  const page = renderPage(servers, clients, token, Boolean(key));

  let settled = false;
  const idle = setTimeout(() => {
    if (settled) return;
    error("No response from the browser in 10 minutes — giving up.");
    process.exit(1);
  }, IDLE_TIMEOUT_MS);

  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      if (url.searchParams.get("token") !== token) {
        res.writeHead(403).end("forbidden");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
      return;
    }
    if (req.method === "POST" && url.pathname === "/apply") {
      if (req.headers["x-connect-token"] !== token) {
        res.writeHead(403).end();
        return;
      }
      let body: { servers?: string[]; clients?: string[]; apiKey?: string };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400).end();
        return;
      }
      const chosen = servers.filter((s) => body.servers?.includes(s.slug));

      // A pasted key completes the sign-in right here: verify it against a
      // live endpoint, persist it for the CLI, and write it into every entry.
      // A key that answers 401 is rejected before anything is written.
      let applyKey = key;
      if (body.apiKey) {
        const verdict = await validateKey(body.apiKey);
        if (verdict === "bad") {
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              results: [
                { client: "sign-in", ok: false, message: "the platform rejected this key — check it and retry" },
              ],
              done: false,
            })
          );
          console.log(`  ${chalk.red("✗")} sign-in: pasted key rejected by the platform`);
          return;
        }
        if (!options.dryRun) setApiKey(body.apiKey);
        applyKey = body.apiKey;
        console.log(`  ${chalk.green("✓")} sign-in: key verified and stored for the aisa CLI`);
      }

      const results = await applySelection(body.clients ?? [], chosen, applyKey, Boolean(options.dryRun));
      const done = results.length > 0 && results.every((r) => r.ok);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ results, done }));

      for (const r of results) {
        const mark = r.ok ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${mark} ${r.client}: ${r.message}`);
      }
      if (done && !settled) {
        settled = true;
        clearTimeout(idle);
        success(
          options.dryRun
            ? "Dry run complete — nothing was written."
            : `Connected ${chosen.length} servers to ${results.length} client(s)`
        );
        hint("Restart your agent to activate (or run /mcp inside Claude Code)");
        // Give the response a moment to flush before tearing the server down.
        setTimeout(() => {
          srv.close();
          process.exit(0);
        }, 300);
      }
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    srv.listen(options.port ? Number(options.port) : 0, "127.0.0.1", resolve);
  });
  const addr = srv.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
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
