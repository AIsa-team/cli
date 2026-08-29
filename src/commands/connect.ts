import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { success, error, info, hint } from "../utils/display.js";
import { expandHome } from "../utils/file.js";
import { MCP_CONFIGS, MCP_DEFAULT_SLUGS, AISA_PROVIDER_ID } from "../constants.js";
import { getApiKey } from "../config.js";
import { fetchLiveServers, writeClientConfig, buildEntry, stripped, type LiveServer } from "./mcp.js";
import { INSTALLERS, installAgent, isInstalled, supported } from "./install.js";
import {
  writeCodexLLM,
  writeClaudeCodeLLM,
  writeOpencodeLLM,
  writeCodexAisaProfile,
  writeOpencodeAisaBackup,
  defaultModelsFor,
  patchCodexMCPAuth,
  DEFAULT_MODELS,
} from "./llm-config.js";
import { writeClaudeAisaSettings, installWrappers } from "./wrappers.js";
import { mintCliKey } from "./oauth-login.js";
import { vscodeDetected, vscodeUserDir, writeVSCodeLLM, writeVSCodeMCP, installVSCodeExtension, launchVSCode, VSCODE_MODELS } from "./vscode.js";
import { formatMicrosUSD } from "./account.js";
import { apiRequest } from "../api.js";
import { run, runSync, QUICK_TIMEOUT_MS } from "../utils/exec.js";
import { Journal } from "../utils/journal.js";
import { VERSION } from "../constants.js";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  RED, RED_CTA, INK, PAPER, I, LOGO, CATEGORY_ICON, EXAMPLES, FILE_CLIENT_LABELS, CLIENT_LOGOS,
  type ClientInfo, type ApplyResult, type StepState, type Step, type AuthState, type RunState,
  type LlmMode,
  CODEX_FACE, CLAUDE_BOT, OPENCODE_MARK,
} from "./connect-shared.js";
import { renderT2Page } from "./connect-t2.js";

/**
 * Page templates. T1 is the original two-page flow (selection + live
 * progress, then a separate success page); T2 is the guided six-step flow.
 * Both run on the same server endpoints, so switching is a render choice:
 * `--template t1` or AISA_CONNECT_TEMPLATE=t1. More templates slot in here.
 */
export const CONNECT_TEMPLATES = ["t1", "t2"] as const;
export type ConnectTemplate = (typeof CONNECT_TEMPLATES)[number];
export const DEFAULT_TEMPLATE: ConnectTemplate = "t2";

export function resolveTemplate(flag: string | undefined): ConnectTemplate {
  const raw = (flag ?? process.env.AISA_CONNECT_TEMPLATE ?? DEFAULT_TEMPLATE).toLowerCase();
  return (CONNECT_TEMPLATES as readonly string[]).includes(raw) ? (raw as ConnectTemplate) : DEFAULT_TEMPLATE;
}

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
 * - Sign-in is one OAuth round for everything: with no key stored, the run
 *   starts with the same browser approval `aisa login` uses, which mints the
 *   durable "aisa cli" key (POST /v1/keys/mint). Every MCP entry is then
 *   written as a bearer and the model provider gets the same key — zero
 *   per-server authorization popups. Only if that sign-in fails do we fall
 *   back to each client's own OAuth machinery (`claude mcp login <name>` per
 *   server; `codex mcp add` runs its own flow), which still works but costs
 *   one browser round per server. A key configured beforehand skips the
 *   sign-in entirely.
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



/** How long the page may sit untouched before we give up and exit. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** How long the success page stays served before the process exits. Copy
 *  buttons are client-side, so the page keeps working after exit. */
const LINGER_AFTER_DONE_MS = 30 * 60 * 1000;
/** How long to wait for the T2 page to finish playing its checklist before
 *  the success tab opens anyway (the tab may have been closed). */
const PAGE_SEEN_TIMEOUT_MS = 90 * 1000;


export function detectClients(): ClientInfo[] {
  const clients: ClientInfo[] = [];

  // Claude Code: presence means the `claude` binary answers on PATH. Its MCP
  // entries live in user scope managed by the binary itself, not in a config
  // file we own — hence kind "cli".
  const probe = runSync("claude", ["--version"], { timeout: 5_000 });
  const claudeVersion = probe.status === 0 ? probe.stdout.trim() : "";
  clients.push({
    id: "claude-code",
    label: "Claude Code",
    kind: "cli",
    detected: probe.status === 0,
    detail: claudeVersion || "claude not found on PATH",
  });

  // Codex keeps its MCP servers in ~/.codex/config.toml, so like Claude Code
  // it is detected by asking the binary rather than by looking for a file we
  // own.
  const codex = runSync("codex", ["--version"], { timeout: 5_000 });
  clients.push({
    id: "codex",
    label: "Codex",
    kind: "cli",
    detected: codex.status === 0,
    detail: codex.status === 0 ? codex.stdout.trim() : "codex not found on PATH",
  });

  // opencode: `opencode mcp add` (1.18+) writes the MCP entries; models go
  // into its one JSON config. Detection stays the same discipline: actually
  // run the binary.
  const oc = runSync("opencode", ["--version"], { timeout: 5_000 });
  clients.push({
    id: "opencode",
    label: "opencode",
    kind: "cli",
    detected: oc.status === 0,
    detail: oc.status === 0 ? `opencode ${oc.stdout.trim()}` : "opencode not found on PATH",
  });

  // VS Code: its chat models and MCP servers are both files in the user
  // profile directory, written without the UI. Detected when that
  // directory exists, i.e. VS Code has run here at least once.
  clients.push({
    id: "vscode",
    label: "VS Code",
    kind: "file",
    detected: vscodeDetected(),
    detail: vscodeDetected() ? vscodeUserDir().replace(homedir(), "~") : "VS Code has not been run on this machine",
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
  await run("claude", ["mcp", "remove", "-s", "user", name], { timeout: 15_000 }).catch(
    () => {}
  );
  const args = ["mcp", "add", "-s", "user", "--transport", "http", name, endpoint];
  if (key) args.push("--header", `Authorization: Bearer ${key}`);
  await run("claude", args, { timeout: 15_000 });
}

/**
 * Add one server to Codex, letting Codex do the authorising.
 *
 * `codex mcp add --url` detects that the endpoint speaks OAuth and starts the
 * flow itself — one command instead of the add-then-login pair Claude Code
 * needs. Writing config.toml directly, as an earlier version did, skips that
 * detection entirely and leaves entries that list as "Not logged in": present,
 * enabled, and 401 on first use.
 *
 * stdio is inherited because the flow prints an authorisation URL and waits.
 */
function codexAdd(name: string, endpoint: string, key: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ["mcp", "add", name, "--url", endpoint];
    // Codex takes the *name* of an environment variable, never the token
    // itself — so a key never reaches the process table or a shell history.
    // With one configured we point every server at the same variable; without
    // one, add detects OAuth support and authorises instead.
    if (key) args.push("--bearer-token-env-var", CODEX_KEY_ENV_VAR);
    const child = spawn("codex", args, { stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
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


/**
 * Cursor's install deeplink: `cursor://anysphere.cursor-deeplink/mcp/install`
 * with the server name and its config (the same shape Cursor keeps in
 * mcp.json) base64-encoded. Cursor opens a confirmation showing the config,
 * then writes the entry itself — the one-click path Cursor documents.
 */
export function cursorDeeplink(name: string, endpoint: string, key: string | undefined): string {
  const config = Buffer.from(JSON.stringify(buildEntry("url", endpoint, key)), "utf8").toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

async function applySelection(
  clientIds: string[],
  chosen: LiveServer[],
  key: string | undefined,
  dryRun: boolean,
  state?: RunState
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const id of clientIds) {
    if (id === "cursor" && state?.deeplinks) {
      // T2: hand Cursor its own deeplinks instead of writing mcp.json — the
      // user confirms each inside Cursor, which then owns the entry.
      state.deeplinks = chosen.map((s) => ({
        slug: s.slug,
        name: `aisa-${s.slug}`,
        url: cursorDeeplink(`aisa-${s.slug}`, s.endpoint, key),
      }));
      results.push({
        client: id,
        ok: true,
        message: `${chosen.length} install link${chosen.length === 1 ? "" : "s"} ready — open them in Cursor`,
      });
    } else if (id === "claude-code") {
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
    } else if (id === "codex") {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would run codex mcp add for ${chosen.length} servers` });
        continue;
      }
      let added = 0;
      for (const s of chosen) {
        const name = `aisa-${s.slug}`;
        // Remove first: codex mcp add refuses an existing name, and removing
        // one that is absent is a no-op we do not care about either way.
        await run("codex", ["mcp", "remove", name], { timeout: 15_000 }).catch(() => {});
        if (!(await codexAdd(name, s.endpoint, key))) continue;
        // The add stored only the env-var NAME; swap it for the literal
        // header so the entry works in every terminal, exported or not.
        if (key && !patchCodexMCPAuth(name, key).ok) continue;
        added++;
      }
      results.push(
        added === chosen.length
          ? {
              client: id,
              ok: true,
              message: key
                ? `${added} servers added with your key`
                : `${added} servers added and authorized`,
            }
          : { client: id, ok: false, message: `only ${added} of ${chosen.length} servers were added` }
      );
    } else if (id === "opencode") {
      // The official command (1.18+): non-interactive, idempotent on the
      // name, writes opencode.jsonc in the exact schema shape. Same doctrine
      // as the other CLI agents — never hand-write what the vendor's own
      // command can write.
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would run opencode mcp add for ${chosen.length} servers` });
        continue;
      }
      let added = 0;
      for (const s of chosen) {
        const args = ["mcp", "add", `aisa-${s.slug}`, "--url", s.endpoint];
        if (key) args.push("--header", `Authorization=Bearer ${key}`);
        try {
          await run("opencode", args, { timeout: 30_000 });
          added++;
        } catch {
          /* counted below */
        }
      }
      results.push(
        added === chosen.length
          ? {
              client: id,
              ok: true,
              message: key
                ? `${added} servers added with your key`
                : `${added} servers added — opencode runs its own OAuth on first start`,
            }
          : { client: id, ok: false, message: `only ${added} of ${chosen.length} servers were added` }
      );
    } else if (id === "vscode") {
      if (dryRun) {
        results.push({ client: id, ok: true, message: `would write ${chosen.length} servers to VS Code's mcp.json` });
        continue;
      }
      const r = writeVSCodeMCP(chosen, key);
      results.push(
        r.ok
          ? { client: id, ok: true, message: `${r.written} servers → ${r.path.replace(homedir(), "~")}${key ? "" : " — VS Code signs in on first use"}` }
          : { client: id, ok: false, message: r.reason }
      );
    } else if (id === "claude-ai") {
      // Nothing on this machine to write: claude.ai takes remote MCP servers
      // as Connectors pasted in by the user, with its own OAuth. The page
      // hands over the URLs; this step only confirms they are ready.
      results.push({
        client: id,
        ok: true,
        message: `${chosen.length} connector URL${chosen.length === 1 ? "" : "s"} ready — add them in claude.ai`,
      });
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


/** Long enough to read one sentence before the screen changes under you.
 *  Every handoff to the browser or to a slow command gets one. */
const BEFORE_HANDOFF_MS = 3000;

/** Passed to `codex mcp add --bearer-token-env-var` so the add does not start
 *  its own OAuth flow; the entry is then patched to carry the literal header
 *  (see applySelection), because nothing guarantees a shell exports this.
 *  Matches the CLI's own variable so an exported key also just works. */
const CODEX_KEY_ENV_VAR = "AISA_API_KEY";

/** Below this the balance step lingers and nudges towards a top-up. */
const LOW_BALANCE_MICROS = 5_000_000;

/** The manual fallback when the inline sign-in cannot mint a key. */
const CONSOLE_KEYS_URL = "https://console.aisa.one/api-keys";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mutate one step in place; the page picks it up on its next poll. */
function setStep(state: RunState, id: string, patch: Partial<Step>): void {
  const step = state.steps.find((s) => s.id === id);
  if (step) Object.assign(step, patch);
}


interface PlanInput {
  install: string[];
  clients: string[];
  servers: LiveServer[];
  keyed: boolean;
  dryRun: boolean;
  llmMode: LlmMode;
  /** Cursor via install deeplinks rather than a config-file write (T2). */
  deeplink?: boolean;
}

/**
 * The plan the page renders before anything runs.
 *
 * Order matters and mirrors what a person would do by hand: get the agent on
 * the machine, prove who you are, see whether you can pay for anything, then
 * wire the capabilities up. A later step that depends on an earlier one is
 * marked skipped rather than failed when its prerequisite did not happen —
 * "skipped" is information, "failed" is alarm.
 */
function buildPlan(input: PlanInput): Step[] {
  const steps: Step[] = [];
  for (const id of input.install) {
    const label = INSTALLERS[id]?.label ?? id;
    steps.push({
      id: `install:${id}`,
      label: `Install ${label}`,
      state: "pending",
      detail: INSTALLERS[id]?.command,
    });
  }
  // The aisa command itself, so the npx visitor leaves with the full
  // toolbox (balance, topup, login/key rotation) — shown as its own step,
  // never a silent side effect. Always listed, so the plan reads the same on
  // every machine; when the command is already there the step simply says so.
  steps.push({
    id: "install:aisa-cli",
    label: "Install the AIsa CLI",
    state: "pending",
    detail: isInstalled("aisa")
      ? "the aisa command is already on this machine"
      : "npm install -g @aisa-one/cli — the aisa command for balance, top-up and key rotation",
  });
  // One sign-in, before anything that wants a credential: the browser
  // approval mints the durable CLI key, and with it every MCP entry is a
  // bearer and the model provider can be written — no per-server popups.
  // If it fails at run time the per-server OAuth rounds come back as a
  // fallback (added to the plan then, not promised now).
  // Listed in a dry run too, so the rehearsal shows the real sequence.
  if (!input.keyed) {
    steps.push({
      id: "signin",
      label: "Sign in to AIsa",
      state: "pending",
      detail: "one browser approval — it mints your CLI key",
    });
  }
  const web = input.clients[0] === "claude-ai";
  const cursorLinks = input.clients[0] === "cursor" && input.deeplink;
  steps.push({
    id: "mcp",
    label: web
      ? `Prepare ${input.servers.length} connector URL${input.servers.length === 1 ? "" : "s"}`
      : cursorLinks
        ? `Prepare ${input.servers.length} Cursor install link${input.servers.length === 1 ? "" : "s"}`
        : `Add ${input.servers.length} MCP server${input.servers.length === 1 ? "" : "s"}`,
    state: "pending",
    detail: input.clients.join(", "),
  });
  if (input.llmMode === "switch") {
    steps.push({
      id: "llm",
      label: "Point its models at AIsa",
      state: "pending",
      detail: "writes the agent's own provider settings; reversible",
    });
  } else if (input.llmMode === "backup") {
    const target = input.clients[0];
    steps.push({
      id: "llm-backup",
      label:
        target === "claude-code"
          ? "Install the claude-aisa command"
          : target === "codex"
            ? "Add the aisa profile and codex-aisa command"
            : target === "vscode"
              ? `Add ${VSCODE_MODELS.length} AIsa models to VS Code chat`
              : "Add AIsa as a backup provider",
      state: "pending",
      detail: "your current models and settings stay untouched",
    });
  }
  steps.push({
    id: "balance",
    label: "Check your AIsa balance",
    state: "pending",
    detail: "so an empty account is not a surprise at the first call",
  });
  return steps;
}

interface RunInput {
  install: string[];
  clients: string[];
  servers: LiveServer[];
  key: string | undefined;
  dryRun: boolean;
  llmMode: LlmMode;
}

/**
 * Run the plan, updating state as each step settles. Returns how many failed.
 *
 * Nothing here throws: one broken step must not cost the user the rest of the
 * run, so every failure is recorded on its own row and the plan continues.
 */
async function runPlan(state: RunState, input: RunInput, log: Journal): Promise<number> {
  let failures = 0;
  const label = (id: string) => state.steps.find((s) => s.id === id)?.label ?? id;
  const fail = (id: string, detail: string) => {
    failures++;
    setStep(state, id, { state: "fail", detail });
    log.line("fail", label(id), detail);
  };
  const ok = (id: string, detail: string) => {
    setStep(state, id, { state: "ok", detail });
    log.line("ok", label(id), detail);
  };

  // ── install ──
  for (const id of input.install) {
    const stepId = `install:${id}`;
    const label = INSTALLERS[id]?.label ?? id;
    setStep(state, stepId, {
      state: "running",
      detail: `about to run ${INSTALLERS[id]?.command}`,
    });
    log.line("step", `Installing ${label}`, INSTALLERS[id]?.command);
    await pause(BEFORE_HANDOFF_MS);
    setStep(state, stepId, {
      state: "running",
      detail: `installing — this usually takes under a minute`,
    });
    if (input.dryRun) {
      ok(stepId, "dry run — nothing installed");
      continue;
    }
    const outcome = await installAgent(id);
    if (outcome.ok) {
      ok(stepId, outcome.alreadyInstalled ? "already installed" : "installed");
    } else {
      // Not a hard failure: the user can run the command themselves and the
      // rest of the plan still applies to whatever they already have.
      setStep(state, stepId, {
        state: "fail",
        detail: `${outcome.detail} — run: ${outcome.command}`,
      });
      failures++;
      log.line("fail", `Install ${label}`, outcome.detail);
      log.note("run this yourself, then re-run connect:");
      log.command(outcome.command);
    }
  }

  // ── the CLI itself, so the npx visitor keeps the toolbox ──
  if (state.steps.some((s) => s.id === "install:aisa-cli")) {
    setStep(state, "install:aisa-cli", { state: "running", detail: "npm install -g @aisa-one/cli" });
    const outcome = input.dryRun
      ? { ok: true as const, alreadyInstalled: isInstalled("aisa"), detail: "", command: "" }
      : await installAgent("aisa-cli");
    if (outcome.ok) {
      ok("install:aisa-cli", outcome.alreadyInstalled ? "already installed" : "installed — try `aisa balance` anytime");
    } else {
      // Not fatal: everything else still applies; the user just keeps npx.
      failures++;
      setStep(state, "install:aisa-cli", {
        state: "fail",
        detail: `${outcome.detail} — run: ${outcome.command}`,
      });
    }
  }

  // ── sign in once, before anything that wants a credential ──
  let key = input.key;
  if (state.steps.some((s) => s.id === "signin")) {
    setStep(state, "signin", {
      state: "running",
      detail: "your browser will open — approve the sign-in there…",
    });
    log.line("step", "Signing you in to AIsa", "one browser approval, then a durable key");
    await pause(BEFORE_HANDOFF_MS);
    setStep(state, "signin", {
      state: "running",
      detail: "waiting for you to approve it in the browser tab",
    });
    try {
      if (input.dryRun) {
        ok("signin", "dry run — the browser approval would open here");
      } else {
        key = await mintCliKey({ open: true });
        ok("signin", "signed in — your CLI key is stored");
      }
    } catch (e) {
      // Not fatal: the per-server OAuth path still works, it is just one
      // browser round per server instead of none.
      failures++;
      setStep(state, "signin", {
        state: "fail",
        detail: `${(e as Error).message} — continuing without a key; retry later with 'aisa login'`,
      });
      log.line("fail", "Sign in to AIsa", (e as Error).message);
      if (input.clients.includes("claude-code")) {
        // Claude Code separates add from login, so give the plan its
        // authorization rounds back, in front of the balance step.
        const at = state.steps.findIndex((s) => s.id === "balance");
        const authSteps: Step[] = input.servers.map((s) => ({
          id: `auth:${s.slug}`,
          label: `Authorize aisa-${s.slug}`,
          state: "pending",
          detail: "opens the AIsa sign-in in your browser",
        }));
        state.steps.splice(at === -1 ? state.steps.length : at, 0, ...authSteps);
      }
    }
  }

  // ── MCP entries ──
  const willAuthorize = !key && input.clients[0] === "codex";
  setStep(state, "mcp", {
    state: "running",
    detail: willAuthorize
      ? "adding each server — your browser will open to authorize them"
      : "writing client configuration",
  });
  if (willAuthorize) await pause(BEFORE_HANDOFF_MS);
  const results = await applySelection(input.clients, input.servers, key, input.dryRun, state);
  state.results = results;
  for (const r of results) log.line(r.ok ? "ok" : "fail", r.client, r.message);
  const mcpOk = results.length > 0 && results.every((r) => r.ok);
  if (mcpOk) {
    setStep(state, "mcp", { state: "ok", detail: results.map((r) => r.client).join(", ") });
  } else {
    failures++;
    setStep(state, "mcp", {
      state: "fail",
      detail: results.filter((r) => !r.ok).map((r) => `${r.client}: ${r.message}`).join("; "),
    });
  }

  // ── LLM backup: AIsa beside the user's own setup, nothing switched ──
  if (state.steps.some((s) => s.id === "llm-backup")) {
    const target = input.clients[0];
    setStep(state, "llm-backup", { state: "running", detail: "adding AIsa without touching your setup" });
    if (input.dryRun) {
      ok("llm-backup", "dry run — nothing written");
    } else if (!key) {
      setStep(state, "llm-backup", { state: "skip", detail: "needs a key — run 'aisa login', then 'aisa connect' again" });
    } else if (target === "claude-code") {
      writeClaudeAisaSettings(key, DEFAULT_MODELS);
      const w = installWrappers(["claude-aisa"]);
      if (w.ok) {
        ok("llm-backup", `claude-aisa → ${w.dir}${w.pathHint ? " (add it to PATH: " + w.pathHint + ")" : ""}`);
      } else fail("llm-backup", `could not write the wrapper into ${w.dir}`);
    } else if (target === "codex") {
      const r = writeCodexAisaProfile(key);
      const w = r.ok ? installWrappers(["codex-aisa"]) : { ok: false as const, dir: "", wrote: [] };
      if (r.ok && w.ok) {
        ok("llm-backup", `codex-aisa → ${w.dir}${"pathHint" in w && w.pathHint ? " (add it to PATH: " + w.pathHint + ")" : ""}`);
      } else fail("llm-backup", r.ok ? `could not write the wrapper` : r.reason);
    } else if (target === "opencode") {
      const r = writeOpencodeAisaBackup(key);
      if (r.ok) ok("llm-backup", `aisa provider added — pick aisa/${DEFAULT_MODELS.model} in opencode`);
      else fail("llm-backup", r.reason);
    } else if (target === "vscode") {
      // Preferred: the AIsa extension provisions key and models through VS
      // Code's own command. Fallback: write the models file and let the
      // user paste the key once (the results page explains how).
      setStep(state, "llm-backup", { state: "running", detail: "installing the AIsa extension so VS Code stores your key itself" });
      const ext = installVSCodeExtension();
      if (ext.ok) {
        ok("llm-backup", `${VSCODE_MODELS.length} models under "AIsa" in the chat model picker — key provisioned by the AIsa extension`);
      } else {
        const r = writeVSCodeLLM();
        if (r.ok) ok("llm-backup", `${VSCODE_MODELS.length} models under "AIsa" in the chat model picker — paste your key once there (extension: ${ext.reason})`);
        else fail("llm-backup", r.reason);
      }
    } else {
      setStep(state, "llm-backup", { state: "skip", detail: "not available for this client" });
    }
  }

  // ── LLM provider ──
  if (state.steps.some((s) => s.id === "llm")) {
    setStep(state, "llm", { state: "running", detail: "writing provider settings" });
    if (input.dryRun) {
      ok("llm", "dry run — nothing written");
    } else if (!key) {
      // Only reachable when the sign-in above failed (or was declined): the
      // normal path mints a key before this step runs. A provider entry has
      // nowhere to put an OAuth token, so without a key the fallback is the
      // console page that hands them out, with exact instructions.
      setStep(state, "llm", {
        state: "running",
        detail: "opening console.aisa.one/api-keys — copy a key from there…",
      });
      await pause(BEFORE_HANDOFF_MS);
      openBrowser(CONSOLE_KEYS_URL);
      setStep(state, "llm", {
        state: "skip",
        detail:
          "waiting on a key — run 'aisa login --key <key>' with the one you just copied, then 'aisa connect' again",
      });
      log.line("warn", "No API key yet", "the model provider was not written");
      log.note(`copy a key from ${CONSOLE_KEYS_URL}, then:`);
      log.command("aisa login --key <key>");
      log.command("aisa connect");
    } else {
      const target = input.clients[0];
      const models = defaultModelsFor(target);
      const res =
        target === "codex"
          ? writeCodexLLM(key, models)
          : target === "opencode"
            ? writeOpencodeLLM(key, models)
            : writeClaudeCodeLLM(key, models);
      if (res.ok) {
        ok("llm", `${models.model} via ${res.path}`);
        log.line("write", "Wrote model settings", res.path);
        if (target === "codex") {
          // A freshly installed Codex offers to sign in to OpenAI on first
          // run. Nothing here needs that account, and picking one of those
          // options sends the user down a path that ignores this config.
          log.note("start it in a new terminal — skip any OpenAI sign-in prompt, it is not needed:");
          log.command("codex");
        } else {
          log.note("start it in a new terminal to pick up the new models:");
          log.command(target === "opencode" ? "opencode" : "claude");
        }
      } else fail("llm", res.reason);
    }
  }

  // ── authorization, one browser round per server ──
  const authSteps = state.steps.filter((s) => s.id.startsWith("auth:"));
  if (authSteps.length > 0) {
    if (!mcpOk) {
      for (const step of authSteps) {
        setStep(state, step.id, { state: "skip", detail: "the entries were not added" });
      }
    } else {
      state.phase = "authorizing";
      log.line("step", "Authorizing each server in your browser");
      for (const step of authSteps) {
        const slug = step.id.slice("auth:".length);
        const name = `aisa-${slug}`;
        // Say what is about to happen, then pause long enough to read it.
        // A browser tab that appears with no warning reads as something going
        // wrong; a sentence and a beat make it an expected step.
        setStep(state, step.id, {
          state: "running",
          detail: "opening the AIsa sign-in in your browser — approve it there…",
        });
        await pause(BEFORE_HANDOFF_MS);
        setStep(state, step.id, {
          state: "running",
          detail: "waiting for you to approve it in the browser tab",
        });
        state.auth[name] = "authorizing";
        const authorized = await claudeCodeLogin(name);
        state.auth[name] = authorized ? "ok" : "fail";
        if (authorized) ok(step.id, "authorized");
        else fail(step.id, `not authorized — retry with: claude mcp login ${name}`);
      }
    }
  }

  // ── balance, the last thing before the success page ──
  setStep(state, "balance", { state: "running", detail: "reading your account" });
  const balance = await readBalance(key);
  state.balanceMicros = balance;
  if (balance === null) {
    // Not a failure: an unknown balance costs nothing.
    setStep(state, "balance", {
      state: "skip",
      detail: key
        ? "could not read the balance right now"
        : "needs a key — run 'aisa login', then 'aisa balance'",
    });
  } else if (balance <= 0) {
    setStep(state, "balance", {
      state: "ok",
      detail: "no credit yet — add some with 'aisa topup' before your first call",
    });
    log.line("warn", "No credit yet", "your first call will fail without it");
    log.command("aisa topup", "add credit");
  } else if (balance <= LOW_BALANCE_MICROS) {
    setStep(state, "balance", {
      state: "ok",
      detail: `${formatMicrosUSD(balance)} available — running low; top up on the results page so nothing stops mid-task`,
    });
  } else {
    setStep(state, "balance", { state: "ok", detail: `${formatMicrosUSD(balance)} available` });
  }

  return failures;
}

/** Account balance in micros, or null when it cannot be read. */
async function readBalance(key: string | undefined): Promise<number | null> {
  if (!key) return null;
  try {
    const res = await apiRequest<{ account_balance_micros_usd: number }>(key, "credits/balance");
    if (!res.success || !res.data) return null;
    return Number(res.data.account_balance_micros_usd);
  } catch {
    return null;
  }
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
    font: 16px/1.6 Inter, "Inter Fallback", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
    background-image: radial-gradient(color-mix(in srgb, var(--muted) 22%, transparent) 1px, transparent 1px);
    background-size: 22px 22px; }
  .bar { background: var(--bar); color: #fff; display: flex; align-items: center;
    gap: .55rem; padding: .8rem 1.4rem; font-weight: 600; }
  .bar .tag { margin-left: .4rem; font-weight: 400; opacity: .55; font-size: .85rem; }
  .bar .local { margin-left: auto; font-weight: 400; font-size: .78rem; opacity: .5; }
  main { padding: 1.7rem 12% 4rem; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 552px; gap: 2.6rem;
    align-items: start; margin-top: 1rem; }
  .rail { position: sticky; top: 1.4rem; }
  .rail h2:first-child { margin-top: .4rem; }
  @media (max-width: 1180px) {
    main { padding: 2.4rem 6% 4rem; }
    .cols { grid-template-columns: 1fr; }
    .rail { position: static; }
  }
  .eyebrow { display: flex; align-items: center; gap: .55rem; color: var(--muted);
    font-size: .74rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
  .eyebrow::before { content: ""; width: 26px; height: 3px; background: var(--red); }
  h1 { font-size: 2.05rem; font-weight: 800; letter-spacing: -.02em; margin: .4rem 0 .35rem; }
  h1 em { font-style: normal; color: var(--red); }
  .lede { color: var(--muted); max-width: none; font-size: .98rem; }
  h2 { display: flex; align-items: center; gap: .55rem; font-size: 1.08rem; font-weight: 700;
    margin: 2rem 0 .9rem; }
  h2 .n { display: inline-flex; align-items: center; justify-content: center; width: 24px;
    height: 24px; border-radius: 50%; background: var(--red); color: #fff; font-size: .8rem; }
  .cat { display: flex; align-items: center; gap: .45rem; color: var(--muted);
    font-size: .8rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
    margin: 1.2rem 0 .5rem; }
  .cat svg { width: 15px; height: 15px; }
  .card { display: flex; gap: .9rem; align-items: flex-start; background: var(--card);
    border: 1px solid var(--line); border-left: 3px solid var(--line); border-radius: 8px;
    padding: 1rem 1.1rem; margin-bottom: .6rem; cursor: pointer; transition: border-color .15s; }
  .card:hover { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
  .card.on { border-left-color: var(--red); background: color-mix(in srgb, var(--tint) 55%, var(--card)); }
  .card.off { opacity: .55; cursor: default; }
  .card input { width: 20px; height: 20px; margin-top: .2rem; accent-color: var(--red-cta); flex: none; }
  .card .body { min-width: 0; }
  .card .head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
  .card .name { font-weight: 700; }
  .clogo { display: inline-flex; align-items: center; margin-right: .55rem; flex: none; }
  .clogo svg { display: block; }
  .badge { font-size: .74rem; font-weight: 700; padding: .18rem .62rem; border-radius: 99px;
    border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .badge.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
  .badge.todo { background: #f59e0b; border-color: #f59e0b; color: #fff; }
  /* The no-model warning: the one place on the page allowed to shout. A
     freshly installed agent with no backend is a broken first-run. */
  .modelwarn { margin-top: .7rem; border: 2px solid #f59e0b; border-radius: 10px;
    background: color-mix(in srgb, #f59e0b 12%, var(--card)); padding: .9rem 1rem; }
  .modelwarn .mw-head { font-weight: 800; font-size: 1rem; color: color-mix(in srgb, #b45309 60%, var(--ink));
    margin-bottom: .35rem; }
  .modelwarn .mw-body { font-size: .92rem; color: color-mix(in srgb, #92400e 45%, var(--ink)); line-height: 1.5; }
  .modelwarn .mw-fix { margin-top: .7rem; background: var(--cta); color: #fff;
    border: 0; border-radius: 6px; padding: .55rem 1.3rem; font-weight: 700;
    font-size: .95rem; cursor: pointer; }
  .modelwarn .mw-fix:hover { filter: brightness(1.08); }
  @keyframes mwshake { 0%,100% { transform: translateX(0); }
    25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
  /* The loud state a card jumps to the moment its install step succeeds. */
  .badge.installed { background: var(--ok); border-color: var(--ok); color: #fff; }
  .card.freshly-installed { border-color: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
  .card .brief { color: var(--muted); font-size: .93rem; }
  .card .desc { color: var(--muted); font-size: .93rem; margin-top: .25rem;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card.open .desc { display: block; -webkit-line-clamp: unset; }
  .card .more { display: inline-block; margin-top: .15rem; color: var(--red); font-weight: 600;
    font-size: .82rem; cursor: pointer; }
  .chips { color: var(--muted); font-size: .82rem; margin: .2rem 0 .4rem; line-height: 1.9; }
  .chips b { color: var(--ink); font-weight: 600; }
  .authnote { display: flex; gap: .7rem; align-items: flex-start; background: var(--card);
    border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1.1rem; color: var(--muted);
    font-size: .93rem; }
  .authnote svg { flex: none; margin-top: .1rem; color: var(--red); }
  .authnote b { color: var(--ink); }
  .cta { display: flex; width: 100%; align-items: center; justify-content: center; gap: .6rem;
    margin-top: 1.6rem; background: var(--red-cta); color: #fff; border: none; border-radius: 6px;
    font: inherit; font-weight: 600; font-size: 1.12rem; padding: .95rem 2.2rem; cursor: pointer; }
  .cta:hover { background: color-mix(in srgb, var(--red-cta) 88%, black); }
  .cta:disabled { opacity: .55; cursor: default; }
  a.cta { text-decoration: none; margin-top: .9rem; }
  .fine { color: var(--muted); font-size: .84rem; margin-top: .8rem; }
  #progress { margin-top: 1.6rem; display: none; }
  .step { display: flex; align-items: flex-start; gap: .7rem; padding: .6rem .2rem;
    border-bottom: 1px dashed var(--line); font-size: .95rem;
    opacity: .5; transition: opacity .3s; }
  .step.running, .step.ok, .step.fail { opacity: 1; }
  .step .body { min-width: 0; }
  .step .lbl { display: block; font-weight: 500; }
  .step .det { display: block; color: var(--muted); font-size: .84rem; margin-top: .15rem; }
  .step .st { margin-left: auto; font-size: .8rem; font-weight: 600; color: var(--muted);
    white-space: nowrap; padding-left: .6rem; }
  .step.ok .st { color: var(--ok); } .step.fail .st { color: var(--red); }
  /* The marker carries the state: an empty ring waiting, a spinner working,
     a tick or cross when settled. Position is fixed so rows never jump. */
  .step .mark { flex: none; width: 16px; height: 16px; margin-top: .15rem;
    border-radius: 50%; border: 2px solid var(--line); display: flex;
    align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
    color: #fff; transition: background .25s, border-color .25s; }
  .step.running .mark { border-color: var(--red); border-top-color: transparent;
    animation: r .8s linear infinite; }
  .step.ok .mark { background: var(--ok); border-color: var(--ok); }
  .step.ok .mark::after { content: "\\2713"; }
  .step.fail .mark { background: var(--red); border-color: var(--red); }
  .step.fail .mark::after { content: "\\2715"; }
  .step.skip .mark { border-style: dotted; }
  .spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--line);
    border-top-color: var(--red); border-radius: 50%; animation: r 1s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  /* Overall progress: one bar so a long run reads at a glance. */
  .bar-wrap { height: 4px; background: var(--line); border-radius: 99px; overflow: hidden;
    margin: .9rem 0 .3rem; }
  .bar-fill { height: 100%; width: 0; background: var(--red); border-radius: 99px;
    transition: width .4s ease; }
  .bar-note { color: var(--muted); font-size: .8rem; }
  .bigcheck { width: 64px; height: 64px; border-radius: 50%; background: var(--red);
    color: #fff; display: flex; align-items: center; justify-content: center; margin-bottom: 1.2rem; }
  .bigcheck svg { width: 34px; height: 34px; }
  .examples { display: grid; grid-template-columns: 1fr; gap: .8rem; max-width: 62rem; }
  .example { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
    padding: 1rem 1.1rem; display: flex; gap: .9rem; align-items: flex-start; }
  .example .txt { font-size: .95rem; }
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
<div class="bar">${LOGO}
<span class="tag">MCP Connect</span><span class="local">local · 127.0.0.1</span></div>
<main>${body}</main>
</body></html>`;
}

// ── page A: selection + live progress ───────────────────────────────────────


function renderPage(
  servers: LiveServer[],
  clients: ClientInfo[],
  token: string,
  keyed: boolean,
  canInstall: boolean
): string {
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
          // The full manifest description, CSS-clamped to two lines; "more"
          // expands it and is hidden by the page script when the text already
          // fits — so short cards carry no dead link and long ones stay tidy.
          return `<label class="card ${checked ? "on" : ""}" data-kind="server">
  <input type="checkbox" name="server" value="${s.slug}" ${checked}>
  <span class="body"><span class="head"><span class="name">${stripped(s.name)}</span>
    <span class="badge">${s.toolCount} tools</span></span>
    <span class="desc">${s.description}</span>
    <span class="more" data-more>more</span></span></label>`;
        })
        .join("\n");
      return `<div class="cat">${CATEGORY_ICON[cat] ?? I.sparkles}${cat}</div>\n${rows}`;
    })
    .join("\n");

  const usable = clients.filter((c) => c.detected);
  const installable = clients.filter((c) => !c.detected && INSTALLERS[c.id] && canInstall);
  const rest = clients.filter(
    (c) => !c.detected && !installable.some((i) => i.id === c.id)
  );
  // One target per run, on purpose. Each client has its own install, config
  // format and authorisation dance; doing several at once turns one failure
  // into a puzzle about which of them failed and what state the rest are in.
  const clientRows =
    usable
      .map(
        (c, i) => `<label class="card${i === 0 ? " on" : ""}" data-kind="client">
  <input type="radio" name="client" value="${c.id}"${i === 0 ? " checked" : ""}>
  <span class="body"><span class="head">${CLIENT_LOGOS[c.id] ? `<span class="clogo">${CLIENT_LOGOS[c.id]}</span>` : ""}<span class="name">${c.label}</span>
    <span class="badge ok">✓ detected</span></span>
    <span class="brief">${c.detail}</span></span></label>`
      )
      .join("\n") +
    installable
      .map(
        (c) => `<label class="card" data-kind="client" data-cid="${c.id}">
  <input type="radio" name="client" value="${c.id}" data-install="1">
  <span class="body"><span class="head">${CLIENT_LOGOS[c.id] ? `<span class="clogo">${CLIENT_LOGOS[c.id]}</span>` : ""}<span class="name">${c.label}</span>
    <span class="badge todo" data-badge>not installed</span></span>
    <span class="brief" data-brief>Install <b>and</b> connect it \u2014 <code>${INSTALLERS[c.id].command}</code></span></span></label>`
      )
      .join("\n") +
    (rest.length
      ? `<div class="chips">${rest.map((c) => `${c.label} <i>· not found</i>`).join(" &nbsp;&nbsp; ")}</div>`
      : "");

  const totalTools = servers.reduce((n, s) => n + s.toolCount, 0);
  // Named per client so the page can say which model a pick actually gets.
  const modelByClient = Object.fromEntries(
    clients.map((c) => [c.id, defaultModelsFor(c.id).model])
  );
  const authCopy = keyed
    ? `Your configured AIsa API key is written into each entry — <b>no sign-in needed</b>.`
    : `<b>One sign-in, nothing to paste.</b> Your browser opens the AIsa approval
       <b>once</b>; it issues a long-lived key for this machine, and every server
       and model below is configured with it — no further popups.`;

  const body = `
<div class="eyebrow">Connect</div>
<h1><em>AIsa MCP</em> — powerful real-world reach for your agent</h1>
<p class="lede">One connection puts <b>${totalTools} live tools</b> — web search &amp; research,
X/Twitter, Reddit, Instagram, stocks, crypto, prediction markets and B2B data — inside the
coding agent you already use. Pick what you need, press Connect, approve in the browser. Done.</p>

<div class="cols">
<div class="left">
<h2><span class="n">1</span>Choose capabilities</h2>
${serverGroups}
</div>

<aside class="rail">
<h2><span class="n">2</span>Install into</h2>
${clientRows}

<button class="cta" id="apply">Connect ${I.arrow}</button>

<h2 style="margin-top:1.6rem"><span class="n">3</span>Models</h2>
<label class="card" data-kind="llm" id="llmcard">
  <input type="checkbox" id="llm">
  <span class="body"><span class="head"><span class="name">Run it on AIsa models</span></span>
    <span class="brief" id="llmbrief">Points the agent's model traffic at AIsa.
    Reversible \u2014 it writes the agent's own provider settings and nothing else.</span></span></label>

<div id="backupmodes" style="display:none">
<label class="card on" data-kind="lmode">
  <input type="radio" name="lmode" value="backup" checked>
  <span class="body"><span class="head"><span class="name">Add AIsa as a backup — recommended</span></span>
  <span class="brief" id="backupbrief"></span></span></label>
<label class="card" data-kind="lmode">
  <input type="radio" name="lmode" value="switch">
  <span class="body"><span class="head"><span class="name">Switch its models to AIsa</span></span>
  <span class="brief">Points this agent's model traffic at AIsa. Reversible — it writes the
  agent's own provider settings and nothing else.</span></span></label>
<label class="card" data-kind="lmode">
  <input type="radio" name="lmode" value="skip">
  <span class="body"><span class="head"><span class="name">Not now</span></span>
  <span class="brief">Leave models exactly as they are.</span></span></label>
</div>

<div id="modelwarn" class="modelwarn" style="display:none">
  <div class="mw-head">\u26a0\ufe0e Installing without a model backend</div>
  <div class="mw-body">A fresh install <b>cannot answer a single prompt</b> until you
  configure a model provider by hand. Turn on AIsa models and it leaves here ready to
  work: <b>Claude, GPT, Gemini, DeepSeek, Kimi, GLM</b> and the rest, one key,
  prices well below going direct.</div>
  <button type="button" class="mw-fix" id="modelfix">Use AIsa models \u2192</button>
</div>

<h2 style="margin-top:1.6rem"><span class="n">4</span>Authorize</h2>
<div class="authnote">${I.shield}<div>${authCopy}</div></div>
<p class="fine">Served by the local <code>aisa connect</code> process — nothing leaves your
machine except the OAuth you approve. The process exits when everything is connected.</p>

<div id="progress"></div>
<div id="result" class="fine"></div>
</aside>
</div>

<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var btn = document.getElementById("apply");
  var ARROW = btn.innerHTML.replace(/^[^<]*/, "");
  var progress = document.getElementById("progress");
  var result = document.getElementById("result");

  // The button says what pressing it will do: installing is slower and more
  // invasive than writing config, so it should never be a surprise.
  var llmBox = document.getElementById("llm");
  var llmBrief = document.getElementById("llmbrief");
  var LLM_BRIEF = llmBrief.innerHTML;
  var lastClient = null;
  var MODEL_FOR = ${JSON.stringify(modelByClient)};

  function syncButton() {
    if (btn.disabled) return;
    var chosen = document.querySelector('input[name="client"]:checked');
    var installing = chosen && chosen.dataset.install === "1";
    btn.innerHTML = (installing ? "Install &amp; connect " : "Connect ") + ARROW;

    // An agent being installed right now has no model backend at all, so this
    // is on by default there and off for one already in use — changing a
    // working setup should be the user's decision, not ours. Only re-applied
    // when the target changes, so a deliberate tick is never undone.
    if (chosen && chosen.value !== lastClient) {
      lastClient = chosen.value;
      llmBox.checked = Boolean(installing);
      llmBox.closest(".card").classList.toggle("on", llmBox.checked);
      var model = MODEL_FOR[chosen.value] || "";
      llmBrief.innerHTML = (installing
        ? "<b>Recommended \\u2014 a fresh install has no model backend yet.</b> "
        : "") + (model ? "Runs it on <b>" + model + "</b> through AIsa. " : "") + LLM_BRIEF;
      // The warning is derived from this checkbox, so it has to be recomputed
      // here rather than left to the client-radio listener. A client radio
      // matches both '.card input' and 'input[name="client"]', so both
      // listeners fire, in registration order: the one that recomputes the
      // warning runs before this one flips the box. Without this line the
      // warning is decided from the previous target's state, and picking an
      // install target left it showing next to an already-ticked box.
      updateModelWarn();
    }
  }

  // Informed consent is the whole point of backup mode: say exactly what
  // gets installed, that nothing of theirs changes, how to use it, how to
  // remove it. Copy varies per client because the mechanism does.
  var BACKUP_COPY = {
    "claude-code": "Installs one small command, <b><code>claude-aisa</code></b>, next to your other tools. Your original <b><code>claude</code></b> command keeps its login, models and settings <b>exactly as they are</b>. Run <b><code>claude-aisa</code></b> whenever you want <b>Claude, GPT, Gemini, DeepSeek, Kimi, GLM</b> and the rest, at lower prices. Remove it anytime by deleting that one file.",
    codex: "Adds an <b>aisa profile</b> inside codex's own config and a <b>codex-aisa</b> command. Your default codex setup is <b>untouched</b> — <code>codex-aisa</code> (or <code>codex --profile aisa</code>) uses AIsa for that session only. Remove anytime.",
    opencode: "Adds AIsa as an <b>extra provider</b> in opencode's config. Your default model is <b>untouched</b> — pick <code>aisa/\u2026</code> from opencode's model list whenever you want it."
  };
  var backupModes = document.getElementById("backupmodes");
  var llmCard = document.getElementById("llmcard");
  function updateModelsUI() {
    var chosen = document.querySelector('input[name="client"]:checked');
    var detectedCli = chosen && chosen.dataset.install !== "1" && BACKUP_COPY[chosen.value];
    backupModes.style.display = detectedCli ? "block" : "none";
    llmCard.style.display = detectedCli ? "none" : "";
    if (detectedCli) document.getElementById("backupbrief").innerHTML = BACKUP_COPY[chosen.value];
  }
  document.querySelectorAll('input[name="lmode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      document.querySelectorAll('[data-kind="lmode"]').forEach(function (c) {
        c.classList.toggle("on", c.querySelector("input").checked);
      });
    });
  });

  var modelWarn = document.getElementById("modelwarn");
  var armed = false;
  function updateModelWarn() {
    var chosen = document.querySelector('input[name="client"]:checked');
    var need = chosen && chosen.dataset.install === "1" && !llmBox.checked;
    modelWarn.style.display = need ? "block" : "none";
    if (!need) armed = false;
  }
  document.getElementById("modelfix").addEventListener("click", function () {
    llmBox.checked = true;
    llmBox.closest(".card").classList.add("on");
    updateModelWarn();
  });
  document.querySelectorAll('input[name="client"]').forEach(function (r) {
    r.addEventListener("change", function () { updateModelWarn(); updateModelsUI(); });
  });
  updateModelsUI();

  llmBox.addEventListener("change", function () {
    updateModelWarn();
    llmBox.closest(".card").classList.toggle("on", llmBox.checked);
  });

  document.querySelectorAll(".card input").forEach(function (cb) {
    cb.addEventListener("change", function () {
      if (cb.type === "radio") {
        // A radio unchecks its siblings without firing their events, so the
        // whole group is repainted rather than just this row.
        document.querySelectorAll('input[name="' + cb.name + '"]').forEach(function (r) {
          r.closest(".card").classList.toggle("on", r.checked);
        });
      } else {
        cb.closest(".card").classList.toggle("on", cb.checked);
      }
      syncButton();
    });
  });

  document.querySelectorAll("[data-more]").forEach(function (m) {
    var d = m.previousElementSibling;
    if (d && d.scrollHeight <= d.clientHeight + 8) { m.style.display = "none"; return; }
    m.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var card = m.closest(".card");
      var open = card.classList.toggle("open");
      m.textContent = open ? "less" : "more";
    });
  });

  function picked(name) {
    return Array.prototype.map.call(
      document.querySelectorAll('input[name="' + name + '"]:checked'),
      function (i) { return i.value; });
  }

  var STATE_WORD = { pending: "waiting", running: "working\\u2026", ok: "done",
                     fail: "failed", skip: "skipped" };

  // The moment an install step succeeds, its client card flips to a loud
  // installed state — the card is where the user read "not installed", so
  // the card is where the success must land.
  function syncClientCards(steps) {
    steps.forEach(function (s) {
      if (s.id.indexOf("install:") !== 0 || s.state !== "ok") return;
      var card = document.querySelector('[data-cid="' + s.id.slice(8) + '"]');
      if (!card || card.className.indexOf("freshly-installed") !== -1) return;
      card.className += " freshly-installed";
      var badge = card.querySelector("[data-badge]");
      if (badge) { badge.className = "badge installed"; badge.textContent = "\\u2713 installed"; }
      var brief = card.querySelector("[data-brief]");
      if (brief) brief.innerHTML = "<b>Installed successfully</b> \\u2014 " + (s.detail || "ready to use");
    });
  }

  function renderSteps(steps) {
    if (!steps || !steps.length) return;
    syncClientCards(steps);
    progress.style.display = "block";
    var settled = steps.filter(function (s) {
      return s.state === "ok" || s.state === "skip";
    }).length;
    var failed = steps.filter(function (s) { return s.state === "fail"; }).length;
    var pct = Math.round(((settled + failed) / steps.length) * 100);
    var running = steps.filter(function (s) { return s.state === "running"; })[0];

    var rows = steps.map(function (s) {
      return "<div class='step " + s.state + "'>" +
        "<span class='mark'></span>" +
        "<span class='body'><span class='lbl'>" + s.label + "</span>" +
        (s.detail ? "<span class='det'>" + s.detail + "</span>" : "") +
        "</span><span class='st'>" + (STATE_WORD[s.state] || s.state) + "</span></div>";
    }).join("");

    progress.innerHTML = "<h2><span class='n'>5</span>Setting things up</h2>" +
      "<div class='bar-wrap'><div class='bar-fill' style='width:" + pct + "%'></div></div>" +
      "<div class='bar-note'>" + (settled + failed) + " of " + steps.length + " \\u00b7 " +
      (running ? running.label : (pct === 100 ? "finished" : "starting\\u2026")) + "</div>" +
      rows;

    // The button narrates the phase it is actually in — "Connecting…" over a
    // minute-long install reads as a hang, or worse, as a lie.
    if (running) {
      var BTN_WORD = { install: "Installing\\u2026", signin: "Signing in\\u2026",
        mcp: "Connecting\\u2026", llm: "Configuring models\\u2026",
        auth: "Authorizing\\u2026", balance: "Finishing\\u2026" };
      btn.textContent = BTN_WORD[running.id.split(":")[0]] || "Working\\u2026";
    }

    // The list grows as steps settle; keep the live edge in view, but only
    // when progress actually advanced — re-scrolling on every poll would
    // fight the user's own scrolling. While running, center the active row;
    // once everything settled, go all the way down so the final ticks and
    // the completion note are fully visible before the summary tab opens.
    var sig = steps.map(function (s) { return s.state; }).join(",");
    if (sig !== lastSig) {
      lastSig = sig;
      if (running) {
        var edge = progress.querySelector(".step.running");
        if (edge && edge.scrollIntoView) edge.scrollIntoView({ block: "center", behavior: "smooth" });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }
    }
  }
  var lastSig = "";

  function poll() {
    fetch("/status?token=" + TOKEN).then(function (r) { return r.json(); }).then(function (s) {
      renderSteps(s.steps);
      if (s.phase === "done") {
        document.title = "\\u2713 AIsa Connected";
        // The big CTA is the bridge between the two pages: the summary tab
        // opened itself, but this is where the user is looking.
        var link = s.doneUrl
          ? "<a class='cta' href='" + s.doneUrl + "'>See how to use it \\u2192</a>"
          : "";
        result.innerHTML = "<b>All connected.</b> A summary page with try-it-now examples just opened in a new tab." + link;
        btn.textContent = "Connected";
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        return;
      }
      if (s.phase === "failed") {
        result.innerHTML = "Some steps did not complete — see the list above; the summary page has the details and how to retry.";
        return;
      }
      setTimeout(poll, 1000);
    }).catch(function () { setTimeout(poll, 1500); });
  }

  btn.addEventListener("click", function () {
    var servers = picked("server");
    var chosen = document.querySelector('input[name="client"]:checked');
    if (!servers.length || !chosen) {
      result.textContent = "Pick at least one capability and one client."; return;
    }
    var clients = [chosen.value];
    var install = chosen.dataset.install === "1" ? [chosen.value] : [];
    // Soft block: a fresh install with no model is almost certainly a
    // mistake. First press stops here and points at the warning; a second
    // press is an informed choice and goes through.
    if (install.length && !llmBox.checked && !armed) {
      armed = true;
      updateModelWarn();
      modelWarn.scrollIntoView({ block: "center", behavior: "smooth" });
      modelWarn.style.animation = "none"; void modelWarn.offsetWidth;
      modelWarn.style.animation = "mwshake .45s";
      btn.textContent = "Install anyway, without a model \u2192";
      return;
    }
    btn.disabled = true;
    btn.textContent = install.length ? "Installing\\u2026" : "Connecting\\u2026";
    fetch("/apply", { method: "POST",
      headers: { "content-type": "application/json", "x-connect-token": TOKEN },
      body: JSON.stringify({ servers: servers, clients: clients, install: install,
        llmMode: install.length || backupModes.style.display === "none"
          ? (llmBox.checked ? "switch" : "skip")
          : (document.querySelector('input[name="lmode"]:checked') || {}).value || "skip" })
    }).then(function (r) { return r.json(); }).then(function (data) {
      renderSteps(data.steps);
      poll();
    });
  });
})();
</script>`;
  return shell("AIsa Connect", body);
}

// ── page C: success + try-it-now examples ───────────────────────────────────
function renderDone(
  chosen: LiveServer[],
  clientIds: string[],
  steps: Step[],
  allServers: LiveServer[],
  balanceMicros: number | null,
  llmMode: LlmMode | undefined
): string {
  const clientNames = clientIds
    .map((id) => (id === "claude-code" ? "Claude Code" : FILE_CLIENT_LABELS[id] ?? id))
    .join(", ");
  // One selected server gets two prompts so the page never feels thin; two or
  // more get one prompt each (capped at four cards).
  const withEx = chosen.filter((s) => EXAMPLES[s.slug]);
  const cards =
    withEx.length === 1
      ? EXAMPLES[withEx[0].slug].slice(0, 2).map((text) => ({ slug: withEx[0].slug, text }))
      : withEx.slice(0, 4).map((s) => ({ slug: s.slug, text: EXAMPLES[s.slug][0] }));
  const examples = cards
    .map(
      (c) => `<div class="example"><div><span class="srv">aisa-${c.slug}</span>
<div class="txt">${c.text}</div></div>
<button data-copy="${c.text.replace(/"/g, "&quot;")}">${I.copy} Copy</button></div>`
    )
    .join("\n");
  // The page tells the truth about the run: a failed MCP step means no tools
  // were added, and a page that congratulates anyway (as an earlier version
  // did, over a 0-of-1 add) teaches the user to distrust every later success.
  const failed = steps.filter((s) => s.state === "fail");
  const mcpFailed = failed.some((s) => s.id === "mcp");
  const failBlock = failed.length
    ? `<div class="authnote" style="margin-bottom:1.2rem">${I.shield}<div>
       <b>${failed.length} step${failed.length > 1 ? "s" : ""} did not complete:</b>
       <ul style="margin:.4rem 0 0 1.1rem">${failed
         .map((s) => `<li><b>${s.label}</b> — ${s.detail ?? "failed"}</li>`)
         .join("")}</ul>
       Fix the above, then run <code>npx @aisa-one/cli connect</code> again — it is
       safe to re-run and picks up where things stand.</div></div>`
    : "";
  const toolCount = chosen.reduce((n, s) => n + s.toolCount, 0);
  const remaining = allServers.length - chosen.length;
  const remainingTools = allServers.reduce((n, s) => n + s.toolCount, 0) - toolCount;

  // A run that installed an agent is a much bigger deal than one that only
  // added tools, and the headline must say so: the user walked in with
  // nothing and walked out with a working coding agent on AIsa models.
  const installedAgents = steps
    .filter((s) => s.id.startsWith("install:") && s.state === "ok")
    .map((s) => INSTALLERS[s.id.slice("install:".length)]?.label ?? s.id.slice("install:".length));
  const llmOk = steps.some((s) => s.id === "llm" && s.state === "ok");
  const model = defaultModelsFor(clientIds[0] ?? "");
  const successHeadline = installedAgents.length
    ? `<h1>Congratulations — <em>${installedAgents.join(" & ")}</em> is installed and armed
with <em>${toolCount} powerful tool${toolCount > 1 ? "s" : ""}</em></h1>
<p class="lede"><b>${installedAgents.join(" & ")}</b> is now on this machine, signed in to
AIsa${llmOk ? `, running on <b>${model.model}</b> through AIsa,` : ","} with
${chosen.length} MCP server${chosen.length > 1 ? "s" : ""} wired in — a complete AI setup,
nothing else to configure.</p>`
    : `<h1>Congratulations — your agent just got <em>${toolCount} powerful new tool${toolCount > 1 ? "s" : ""}</em></h1>
<p class="lede">${chosen.length} AIsa MCP server${chosen.length > 1 ? "s are" : " is"} now
installed and signed in for <b>${clientNames}</b> — nothing else to configure.</p>`;
  // Launchable only for the CLI agents, and only while the local process is
  // still alive (it lingers a few minutes) — the button degrades to a
  // "run it yourself" hint once the process has exited.
  //
  // The card mimics each agent's real first screen — Codex's ASCII face
  // (transcribed from its TUI; the binary stores it as fragments) and Claude
  // Code's pixel robot — so the terminal the button opens looks exactly like
  // what the user just previewed. Familiarity is the whole point.
  const backup = llmMode === "backup";
  const launchBin =
    clientIds[0] === "codex" ? (backup ? "codex-aisa" : "codex")
    : clientIds[0] === "claude-code" ? (backup ? "claude-aisa" : "claude")
    : clientIds[0] === "opencode" ? "opencode" : null;
  // Backup mode's one-line contract, repeated where the user will act on it.
  const backupNote = backup
    ? clientIds[0] === "opencode"
      ? `<p class="fine" style="margin:0 0 1.2rem"><b>Your usual setup is untouched.</b> Pick
<code>aisa/\u2026</code> from opencode's model list whenever you want AIsa.</p>`
      : `<p class="fine" style="margin:0 0 1.2rem"><b>Your usual <code>${clientIds[0] === "codex" ? "codex" : "claude"}</code> is untouched.</b> Run
<code>${launchBin}</code> whenever you want AIsa's models; delete that one file to remove it.</p>`
    : "";
  const cwd = process.cwd();
  const termPreview =
    launchBin === "opencode"
      ? `<pre class="termlogo oc">${OPENCODE_MARK}</pre>
<div class="termline">Welcome to <b>opencode</b></div>
<div class="termline dim">model: <b>${AISA_PROVIDER_ID}/${model.model}</b> · via AIsa</div>
<div class="termline dim">config: ~/.config/opencode/opencode.json</div>`
      : launchBin === "codex"
      ? `<pre class="termlogo codex">${CODEX_FACE}</pre>
<div class="termline">Welcome to <b>Codex</b>, OpenAI's command-line coding agent</div>
<div class="termline dim">model: <b>${model.model}</b> · via AIsa</div>`
      : `<pre class="termlogo claude">${CLAUDE_BOT}</pre>
<div class="termline"><b class="ccname">Claude Code</b></div>
<div class="termline dim">${model.model} · via AIsa</div>
<div class="termline dim">${cwd}</div>
<div class="termline accent">Using ${model.model} (from .claude/settings.json)</div>`;
  const launchBlock =
    !mcpFailed && launchBin
      ? `<div class="termcard">
  <div class="termwin">
    <div class="termbar"><span class="tdot r"></span><span class="tdot y"></span><span class="tdot g"></span></div>
    <div class="termbody">${termPreview}</div>
  </div>
  <div class="termside">
    <button class="cta act" id="launch">Launch ${launchBin} →</button>
    <span class="fine" id="launchnote"></span>
  </div>
</div>`
      : "";

  const headline = mcpFailed
    ? `<div class="eyebrow">Almost there</div>
<h1>Your agent is <em>not connected yet</em></h1>
<p class="lede">The MCP entries could not be added to <b>${clientNames}</b> — details below.</p>`
    : `<div class="bigcheck">${I.check}</div>
<div class="eyebrow">Connected</div>
${successHeadline}`;

  // ── the recap: the same journey the first page showed live, replayed as a
  // settled checklist, so the fresh tab connects visually to what the user
  // just watched happen. Every step, including the failed and skipped ones.
  const STEP_ICON: Record<StepState, string> = {
    ok: "✓",
    fail: "✕",
    skip: "–",
    pending: "·",
    running: "·",
  };
  // Check mark at the END of the row: the row reads as a capability gained
  // ("Install Codex — installed ✓"), not as a checklist item to do.
  const recapRows = steps
    .map(
      (s) => `<div class="rstep ${s.state}"><span class="rl">${s.label}</span>
<span class="rd">${s.detail ?? ""}</span><span class="ri">${STEP_ICON[s.state]}</span></div>`
    )
    .join("\n");
  const recap = `
<h2>Everything you just gained</h2>
<div class="recap">
  <div class="rsum">${chosen.length} capabilit${chosen.length === 1 ? "y" : "ies"} · ${toolCount} tools · ${clientNames}</div>
${recapRows}
</div>`;

  // ── the balance card: always shown, always with the top-up button — money
  // is the one thing a user should never have to hunt for. Below $5 the card
  // turns warm and suggests (never demands) a top-up.
  const TOPUP_URL = "https://console.aisa.one/billing?source=aisa_cli";
  const low = balanceMicros !== null && balanceMicros < 5_000_000;
  const balanceCard = `
<div class="balcard${low ? " low" : ""}">
  <div><div class="balnum">${balanceMicros === null ? "—" : formatMicrosUSD(balanceMicros)}</div>
  <div class="ballbl">AIsa balance</div></div>
  <div class="balright">${
    low
      ? `<div class="lownote">Running a little low — a small top-up now keeps your first calls flowing smoothly.</div>`
      : balanceMicros === null
        ? `<div class="lownote">Could not read it just now — <code>aisa balance</code> will.</div>`
        : ""
  }
  <a class="cta topup" href="${TOPUP_URL}" target="_blank" rel="noopener">Top up now →</a></div>
</div>`;

  const body = `
<style>
  h1 { font-size: 2.5rem; }
  .lede { font-size: 1.08rem; }
  .example .txt { font-size: 1.02rem; }
  .example .srv { font-size: .8rem; }
  h2 { font-size: 1.2rem; }
  .fine { font-size: .9rem; }
  .recap { border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    padding: 1rem 1.2rem; margin: 0 0 1.4rem; max-width: 62rem; }
  .rsum { font-weight: 600; padding-bottom: .55rem; border-bottom: 1px dashed var(--line);
    margin-bottom: .55rem; }
  .rstep { display: flex; gap: .7rem; align-items: baseline; padding: .4rem 0;
    font-size: 1.06rem; border-bottom: 1px solid var(--line); }
  .rstep:last-child { border-bottom: 0; }
  .rstep .ri { font-weight: 800; font-size: 1.15rem; flex: none; margin-left: auto; }
  .rstep.ok .ri { color: var(--ok); }
  .rstep.fail .ri { color: #dc2626; }
  .rstep.skip .ri, .rstep.pending .ri { color: #9ca3af; }
  .rstep .rl { font-weight: 700; flex: none; }
  .rstep .rd { color: var(--muted); font-size: .95rem; overflow-wrap: anywhere; }
  .balcard { display: flex; justify-content: space-between; align-items: center;
    gap: 1rem; border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    padding: 1rem 1.2rem; margin: 0 0 1.8rem; max-width: 62rem; flex-wrap: wrap; }
  .balcard.low { border-color: #f59e0b; background: color-mix(in srgb, #f59e0b 12%, var(--card)); }
  .balnum { font-size: 1.6rem; font-weight: 800; }
  .ballbl { font-size: .8rem; color: var(--muted); }
  .balright { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .lownote { font-size: .92rem; color: color-mix(in srgb, #b45309 70%, var(--ink)); max-width: 26rem; }
  .cta.topup, .cta.act { display: inline-block; width: auto; padding: .7rem 1.8rem; }
  /* The launch card: a believable little terminal, agent branding intact,
     with the launch button on the right edge — same edge as Top up above. */
  .termcard { display: flex; justify-content: space-between; align-items: center;
    gap: 1.2rem; border: 1px solid var(--line); border-radius: 12px; background: var(--card);
    padding: 1rem 1.2rem; margin: 0 0 1.8rem; max-width: 62rem; flex-wrap: wrap; }
  .termwin { background: #0d0d0b; border-radius: 10px; overflow: hidden;
    flex: 1 1 24rem; min-width: 0; box-shadow: inset 0 0 0 1px #262622; }
  .termbar { display: flex; gap: .38rem; padding: .5rem .7rem; background: #1a1a17; }
  .tdot { width: .62rem; height: .62rem; border-radius: 50%; }
  .tdot.r { background: #ff5f57; } .tdot.y { background: #febc2e; } .tdot.g { background: #28c840; }
  .termbody { padding: .8rem 1rem 1rem; font-family: ui-monospace, SFMono-Regular,
    Menlo, monospace; font-size: .78rem; line-height: 1.35; }
  .termlogo { margin: 0 0 .6rem; font-size: .35rem; line-height: 1.15; overflow-x: auto; }
  .termlogo.codex { color: #33d17a; }
  .termlogo.oc { color: #fafafa; font-size: .62rem; line-height: 1.2; }
  .termlogo.claude { color: #e07b54; font-size: .56rem; line-height: 1.05; }
  .termline { color: #d8d8d2; padding: .08rem 0; overflow-wrap: anywhere; }
  .termline b { color: #fff; }
  .termline.dim { color: #8a8a82; }
  .termline.accent { color: #d8d8d2; border-left: 2px solid #33d17a; padding-left: .5rem; }
  .termline .prompt { color: #33d17a; font-weight: 700; }
  .ccname { color: #33d17a !important; }
  .termside { display: flex; flex-direction: column; align-items: flex-end;
    gap: .5rem; flex: none; }
</style>
${headline}
${
    mcpFailed
      ? failBlock + recap + balanceCard
      : `<p class="lede" style="margin-top:.6rem">You are now connected to <b>AIsa</b> — a powerful capability layer for agents: one account for
<b>Claude, GPT, Gemini, DeepSeek, Kimi, GLM</b> and the live data behind them: <b>Twitter, SimilarWeb, CoinGecko, Apollo, Polymarket</b> and more.${
          remaining > 0
            ? ` ${remaining} more MCP server${remaining > 1 ? "s" : ""} (${remainingTools} tools) are one
<code>npx @aisa-one/cli connect</code> away.`
            : ""
        }
Explore the platform at <a href="https://aisa.one" target="_blank" rel="noopener">aisa.one</a> ·
usage &amp; billing at <a href="https://console.aisa.one" target="_blank" rel="noopener">console.aisa.one</a>.</p>
${failBlock}
${recap}
${balanceCard}
${backupNote}
${launchBlock}
<h2>${I.sparkles} Try it now — paste one of these into ${clientNames.split(",")[0]}</h2>
<div class="examples">
${examples || '<p class="fine">Ask your agent to use any of the aisa-* MCP tools.</p>'}
</div>
<p class="fine">These first-run prompts mention <b>AIsa</b> once so the demo reliably lands on
your new tools. After that, plain natural language is enough — your agent reaches for AIsa on
its own whenever a task needs live data. Verify anytime with <code>/mcp</code> inside
Claude Code — the entries should show <b>Connected</b>.</p>`
  }
<p class="fine">This page keeps working after the local process exits.</p>
<script>
document.querySelectorAll("[data-copy]").forEach(function (b) {
  b.addEventListener("click", function () {
    navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () {
      b.textContent = "Copied \\u2713"; setTimeout(function () { b.innerHTML = ${JSON.stringify(I.copy + " Copy")}; }, 1600);
    });
  });
});
var launch = document.getElementById("launch");
if (launch) launch.addEventListener("click", function () {
  var token = new URLSearchParams(location.search).get("token");
  var note = document.getElementById("launchnote");
  launch.disabled = true;
  fetch("/launch?token=" + token, { method: "POST" })
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function () {
      launch.textContent = "\\u2713 Opened in Terminal";
      note.textContent = "";
    })
    .catch(function () {
      // Process exited, or no terminal emulator could be started (headless
      // Linux) — the agent is installed either way, one command starts it.
      launch.style.display = "none";
      note.innerHTML = "Could not open a terminal automatically \\u2014 just run <code>${launchBin ?? ""}</code> in any terminal.";
    });
});
</script>`;
  return shell(mcpFailed ? "AIsa \u2014 almost connected" : "\u2713 AIsa Connected", body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Open a real terminal window running the freshly connected agent. The
 * command is a fixed whitelist entry — nothing from the request reaches the
 * shell — and the working directory is where connect was launched, which is
 * almost always the project the user wants the agent in.
 */
function launchAgentTerminal(
  binary: "codex" | "claude" | "opencode" | "claude-aisa" | "codex-aisa"
): Promise<boolean> {
  if (process.platform === "darwin") {
    // osascript ships with macOS — no dependency of ours. First use may show
    // a one-time automation permission prompt; Terminal.app starts a fresh
    // shell, so the cd is explicit.
    const dir = process.cwd().replace(/'/g, "'\\''");
    return run("osascript", [
      "-e",
      `tell application "Terminal" to do script "cd '${dir}' && ${binary}"`,
      "-e",
      'tell application "Terminal" to activate',
    ], { timeout: 30_000 }).then(
      () => true,
      () => false
    );
  }
  // Linux: only meaningful in a graphical session, and there is no single
  // terminal — walk the common ones until one starts. The spawned terminal
  // inherits our cwd, so the agent opens in the right directory without a cd.
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return Promise.resolve(false);
  const candidates: Array<[string, string[]]> = [
    ["x-terminal-emulator", ["-e", binary]],
    ["gnome-terminal", ["--", binary]],
    ["konsole", ["-e", binary]],
    ["xfce4-terminal", ["-e", binary]],
    ["xterm", ["-e", binary]],
  ];
  return candidates.reduce<Promise<boolean>>(
    (chain, [cmd, args]) =>
      chain.then((ok) => ok || run(cmd, args, { timeout: 30_000 }).then(() => true, () => false)),
    Promise.resolve(false)
  );
}

/** Quit and reopen Claude Desktop so it loads the fresh MCP config. The
 *  quit is polite (AppleScript / SIGTERM to the app, never -9); a Claude
 *  Desktop that was not running simply starts. */
function restartClaudeDesktop(): boolean {
  if (process.platform === "darwin") {
    runSync("osascript", ["-e", 'tell application "Claude" to quit'], { timeout: 15_000 });
    const r = runSync("open", ["-a", "Claude"], { timeout: 30_000 });
    return r.status === 0;
  }
  return false;
}

/** Open Cursor on a folder: the bundled `cursor` command on macOS (the
 *  app may not be on PATH), `cursor` elsewhere. */
function launchCursor(dir: string): boolean {
  const candidates =
    process.platform === "darwin"
      ? ["cursor", "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"]
      : ["cursor", "/usr/bin/cursor", "/usr/share/cursor/bin/cursor"];
  for (const c of candidates) {
    const r = runSync(c, [dir], { timeout: 30_000 });
    if (r.status === 0) return true;
  }
  if (process.platform === "darwin") {
    const r = runSync("open", ["-a", "Cursor", dir], { timeout: 30_000 });
    return r.status === 0;
  }
  return false;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  void run(cmd, [url], { timeout: 30_000 }).catch(() => {});
}

/**
 * Where a live run leaves its address, so a second `aisa connect` can offer
 * the first one's page instead of starting a rival server. Ephemeral by
 * design: it lives in the temp directory, carries the pid, and a stale file
 * (crashed run, killed terminal) is detected and replaced rather than
 * trusted — the price of a wrong guess is one dead link, so the check is
 * "is that pid still a connect process", not just "does the file exist".
 */
function runLockPath(): string {
  return join(tmpdir(), `aisa-connect-${process.getuid?.() ?? 0}.json`);
}

interface RunLock {
  pid: number;
  url: string;
  started: number;
}

function readRunLock(): RunLock | null {
  try {
    const lock = JSON.parse(readFileSync(runLockPath(), "utf-8")) as RunLock;
    if (!lock?.pid || !lock.url) return null;
    // Signal 0 only asks "may I signal it"; it never touches the process.
    process.kill(lock.pid, 0);
    return lock;
  } catch {
    return null;
  }
}

function writeRunLock(url: string): void {
  try {
    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(runLockPath(), JSON.stringify({ pid: process.pid, url, started: Date.now() }), "utf-8");
  } catch {
    /* a lock we cannot write is a feature we simply do not get */
  }
}

function clearRunLock(): void {
  try {
    const lock = JSON.parse(readFileSync(runLockPath(), "utf-8")) as RunLock;
    if (lock.pid === process.pid) unlinkSync(runLockPath());
  } catch {
    /* nothing to clear */
  }
}

/**
 * The lock only needs to keep a second run out while the first one is
 * genuinely doing something — writing configs, waiting on a browser OAuth
 * round. Once it settles into "done" or "failed" it is just a results page
 * sitting there; nothing more will be written, so a fresh run is free to
 * start. Ask the old server what phase it is in rather than trusting age:
 * a two-minute-old run can already be done, a twenty-minute-old one can
 * still be mid-authorization. Unreachable (or any other phase) counts as
 * still active — the safe default when we cannot tell.
 */
async function oldRunSettled(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const token = u.searchParams.get("token") ?? "";
    const res = await fetch(`${u.origin}/status?token=${token}`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { phase?: string };
    return data.phase === "done" || data.phase === "failed";
  } catch {
    return false;
  }
}

/**
 * The closing block of a run: what changed on this machine, which commands
 * the user now has, and what to run next. It is the part someone reads
 * after the browser tab is gone — and the part that teaches them to do this
 * by hand next time, so it names files and commands rather than describing
 * them.
 */
function summarise(
  log: Journal,
  r: {
    clientId: string;
    clientLabel: string;
    servers: LiveServer[];
    llmMode: LlmMode;
    steps: Step[];
    balance: number | null;
  }
): void {
  const done = (id: string) => r.steps.some((s) => s.id === id && s.state === "ok");

  log.section("What changed on this machine");
  const mcpMsg = r.steps.find((s) => s.id === "mcp");
  if (mcpMsg?.state === "ok") {
    const where =
      r.clientId === "claude-code" ? "Claude Code's user scope (claude mcp list)"
      : r.clientId === "codex" ? "~/.codex/config.toml"
      : r.clientId === "opencode" ? "~/.config/opencode/opencode.json"
      : r.clientId === "vscode" ? "VS Code's mcp.json"
      : r.clientId === "claude-desktop" ? "claude_desktop_config.json (as mcp-remote bridges)"
      : r.clientId === "cursor" ? "install links you confirm inside Cursor"
      : mcpMsg.detail ?? "";
    log.line("write", `${r.servers.length} MCP server${r.servers.length > 1 ? "s" : ""} → ${where}`);
    for (const srv of r.servers) log.record(`aisa-${srv.slug} → ${srv.endpoint}`);
  }
  if (done("llm")) {
    log.line("write", "Model provider set to AIsa", r.steps.find((s) => s.id === "llm")?.detail);
  }
  if (done("llm-backup")) {
    log.line("write", "AIsa added beside your setup", r.steps.find((s) => s.id === "llm-backup")?.detail);
  }
  if (done("install:aisa-cli")) log.line("write", "AIsa CLI available as `aisa`");
  log.record(`credential: ~/.aisa/key (0600)`);

  log.section("Commands you now have");
  const wrapper =
    r.llmMode === "backup" && r.clientId === "claude-code" ? "claude-aisa"
    : r.llmMode === "backup" && r.clientId === "codex" ? "codex-aisa"
    : null;
  if (wrapper) {
    log.line("cmd", `${wrapper}`, `your usual ${r.clientId === "codex" ? "codex" : "claude"} is untouched`);
    log.command(wrapper, "same agent, AIsa models");
  } else if (r.clientId === "claude-code" || r.clientId === "codex" || r.clientId === "opencode") {
    log.command(r.clientId === "claude-code" ? "claude" : r.clientId, "start it in a new terminal");
  }
  log.command("aisa balance", "check your credit");
  log.command("aisa topup", "add credit");

  log.section("Good to know");
  if (r.clientId === "claude-desktop") log.line("info", "Restart Claude Desktop", "the servers load on start");
  if (r.clientId === "vscode") log.line("info", "VS Code needs no reload", "the servers and models are already there");
  if (r.clientId === "cursor") log.line("info", "Press Install in Cursor", "one confirmation per server");
  log.line("info", "Nothing runs in the background", "this process exits when the results page expires");
  if (r.balance !== null && r.balance <= LOW_BALANCE_MICROS) {
    log.line("warn", `Balance is ${formatMicrosUSD(r.balance)}`, "top up so your agent never stops mid-task");
  }
  if (log.path) log.line("info", "This run was logged to", log.path.replace(homedir(), "~"));
}

export async function connectAction(options: {
  open?: boolean;
  port?: string;
  dryRun?: boolean;
  template?: string;
  force?: boolean;
}): Promise<void> {
  const template = resolveTemplate(options.template);

  // One run at a time. A second one would serve a second page against the
  // same machine — two plans writing the same config files — so point the
  // user at the page that is already open instead. --force overrides for the
  // rare case where the first run is wedged.
  const log = new Journal();
  log.section(`AIsa connect · v${VERSION}`);
  log.line("info", "Machine", `${process.platform} ${process.arch} · node ${process.versions.node}`);

  let live = options.force ? null : readRunLock();
  if (live && (await oldRunSettled(live.url))) {
    // It finished; its results page is just lingering. Nothing more will be
    // written there, so there is nothing to protect against — proceed as if
    // no lock existed. This process's own writeRunLock (below) takes over
    // the file once its server is up.
    const mins = Math.max(1, Math.round((Date.now() - live.started) / 60_000));
    log.line("info", `An earlier run finished ${mins} minute${mins === 1 ? "" : "s"} ago`, "starting a new one");
    live = null;
  }
  if (live) {
    const mins = Math.max(1, Math.round((Date.now() - live.started) / 60_000));
    log.line("info", `A run from ${mins} minute${mins === 1 ? "" : "s"} ago is still open`, `pid ${live.pid}`);
    console.log(`  ${chalk.cyan(live.url)}`);
    log.note("reopening that page — it keeps your progress");
    log.command("aisa connect --force", "start over instead");
    if (options.open !== false) openBrowser(live.url);
    return;
  }
  let servers: LiveServer[];
  try {
    servers = await fetchLiveServers();
  } catch (e) {
    log.line("fail", "Could not read the MCP manifest", (e as Error).message);
    log.note("check your network and try again");
    process.exitCode = 1;
    return;
  }
  const clients = detectClients();
  // Rehearsal aid: in a dry run, pretend the listed clients are present so a
  // page can be reviewed for a client this machine does not have. Never
  // honoured outside --dry-run, where it could only mislead.
  if (options.dryRun && process.env.AISA_CONNECT_PRETEND_DETECTED) {
    const pretend = new Set(process.env.AISA_CONNECT_PRETEND_DETECTED.split(",").map((x) => x.trim()));
    for (const c of clients) if (pretend.has(c.id)) { c.detected = true; c.detail = `${c.detail} (pretend)`; }
  }
  const detected = clients.filter((c) => c.detected);
  if (detected.length === 0) {
    log.line("fail", "No supported client found", "Claude Code, Codex, opencode, VS Code, Cursor, Claude Desktop");
    log.note("install one, or write a config anyway:");
    log.command("aisa mcp setup --agent <client>");
    process.exitCode = 1;
    return;
  }
  const key = getApiKey();

  // One random token per run: the page and every endpoint require it, so
  // another local process cannot drive this server blind.
  const token = randomBytes(16).toString("hex");
  const page =
    template === "t2"
      ? renderT2Page(servers, clients, token, Boolean(key), supported(), "start")
      : renderPage(servers, clients, token, Boolean(key), supported());

  const state: RunState = { phase: "selecting", results: [], auth: {}, steps: [] };
  let chosenServers: LiveServer[] = [];
  let chosenClients: string[] = [];
  let port = 0;

  // T2 tells us when its step-5 animation has finished playing; the success
  // tab waits for that so the user is never yanked away mid-checklist. A
  // closed tab would never say so, hence the bounded wait below.
  let pageSeen: () => void = () => {};
  const pageSeenP = new Promise<void>((r) => (pageSeen = r));

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
      // T2's done view is the same page parked on its last step; T1 has a
      // dedicated success page.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        template === "t2"
          ? renderT2Page(servers, clients, token, Boolean(key), supported(), "done")
          : renderDone(chosenServers, chosenClients, state.steps, servers, state.balanceMicros ?? null, state.llmMode)
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/key") {
      // For the one client that cannot take the key from a file (VS Code):
      // the results page copies it to the clipboard for pasting into the
      // app's own key prompt. Token-gated, loopback only, like everything.
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ key: key ?? null }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/seen") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      pageSeen();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/launch") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      // Whitelist only — the client name selects a fixed binary, and no part
      // of the request ever reaches a shell.
      const backup = state.llmMode === "backup";
      if (chosenClients[0] === "vscode" || chosenClients[0] === "cursor" || chosenClients[0] === "claude-desktop") {
        // Not terminal agents: open (or for Claude Desktop, restart) the app.
        const launched =
          chosenClients[0] === "vscode" ? launchVSCode(process.cwd())
          : chosenClients[0] === "cursor" ? launchCursor(process.cwd())
          : restartClaudeDesktop();
        res.writeHead(launched ? 200 : 500, { "content-type": "application/json" }).end(JSON.stringify({ ok: launched }));
        return;
      }
      const bin =
        chosenClients[0] === "codex" ? (backup ? "codex-aisa" : "codex")
        : chosenClients[0] === "claude-code" ? (backup ? "claude-aisa" : "claude")
        : chosenClients[0] === "opencode" ? "opencode" : null;
      if (!bin) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ ok: false }));
        return;
      }
      // Wait for the real outcome: a 200 over a failed launch would leave the
      // page claiming success it never checked (headless Linux, no terminal
      // emulator found). The page's catch shows the run-it-yourself hint.
      const launched = await launchAgentTerminal(bin);
      res
        .writeHead(launched ? 200 : 500, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: launched }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/apply") {
      if (!tokenOk) {
        res.writeHead(403).end();
        return;
      }
      let body: {
        servers?: string[];
        clients?: string[];
        install?: string[];
        llm?: boolean;
        llmMode?: string;
      };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400).end();
        return;
      }
      chosenServers = servers.filter((s) => body.servers?.includes(s.slug));
      chosenClients = body.clients ?? [];
      const wantInstall = new Set(body.install ?? []);
      // Ticking "install" means "and connect it": nobody installs an agent
      // here except to put AIsa servers in it, and asking twice for the same
      // intention is how a user ends up with an empty Codex.
      for (const id of wantInstall) {
        if (!chosenClients.includes(id)) chosenClients.push(id);
      }
      state.phase = "applying";
      const llmMode: LlmMode =
        body.llmMode === "switch" || body.llmMode === "backup" || body.llmMode === "skip"
          ? body.llmMode
          : body.llm
            ? "switch"
            : "skip";
      state.llmMode = llmMode;
      state.selection = {
        servers: chosenServers.map((s) => s.slug),
        clients: chosenClients,
        install: [...wantInstall],
        llmMode,
      };

      // The whole plan, in order, before any of it runs — the page renders it
      // greyed out so a long install reads as progress rather than a hang.
      // T2 connects Cursor through its install deeplinks; an empty array here
      // is the signal applySelection fills in.
      if (template === "t2" && chosenClients[0] === "cursor") state.deeplinks = [];
      state.steps = buildPlan({
        install: [...wantInstall],
        clients: chosenClients,
        servers: chosenServers,
        keyed: Boolean(key),
        dryRun: Boolean(options.dryRun),
        llmMode,
        deeplink: template === "t2" && chosenClients[0] === "cursor",
      });
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ started: true, steps: state.steps })
      );

      if (settled) return;
      settled = true;
      clearTimeout(idle);

      // Replay the browser's choices in the terminal: the page is transient,
      // the scrollback is not, and a reader who only has this should still
      // know what was decided on their behalf.
      log.section("What you chose");
      const clientLabel = clients.find((c) => c.id === chosenClients[0])?.label ?? chosenClients[0];
      log.line("choice", "Agent", wantInstall.size ? `${clientLabel} (install it first)` : clientLabel);
      log.line(
        "choice",
        "Models",
        llmMode === "switch"
          ? `point ${clientLabel} at AIsa (${defaultModelsFor(chosenClients[0]).model})`
          : llmMode === "backup"
            ? "add AIsa beside your current setup, nothing replaced"
            : "leave models as they are"
      );
      log.line(
        "choice",
        `Capabilities (${chosenServers.length})`,
        chosenServers.map((s) => `aisa-${s.slug}`).join(", ")
      );
      log.section("Setting things up");

      const failures = await runPlan(state, {
        install: [...wantInstall],
        clients: chosenClients,
        servers: chosenServers,
        key,
        dryRun: Boolean(options.dryRun),
        llmMode,
      }, log);
      const results = state.results;
      {
        state.phase = failures > 0 ? "failed" : "done";
        log.section(failures > 0 ? "Finished, with issues" : "🎉 All set");
        if (failures > 0) {
          log.line("warn", `${failures} step${failures > 1 ? "s" : ""} did not complete`, "details above");
        }
        log.line(
          "ok",
          options.dryRun
            ? "Dry run complete — nothing was written"
            : `${chosenServers.length} capabilit${chosenServers.length === 1 ? "y" : "ies"} connected to ${clientLabel}`
        );
        if (!options.dryRun) {
          // The success page opens as a fresh tab from this process (an OS
          // browser launch, so no popup blocker applies) — users who tabbed
          // away to the authorization rarely come back to the first tab.
          const doneUrl = `http://127.0.0.1:${port}/done?token=${token}`;
          state.doneUrl = doneUrl;
          log.line("info", "Opening your results page", "try-it-now prompts and your balance");
          if (template === "t2") await Promise.race([pageSeenP, pause(PAGE_SEEN_TIMEOUT_MS)]);
          await pause(BEFORE_HANDOFF_MS);
          openBrowser(doneUrl);
          const until = new Date(Date.now() + LINGER_AFTER_DONE_MS);
          log.note(
            `the page stays up until ${until.getHours()}:${String(until.getMinutes()).padStart(2, "0")} — Ctrl-C to finish now`
          );
          // Last, so it is the line still on screen: everything else is what
          // happened, this is what to do next.
          summarise(log, {
            clientId: chosenClients[0],
            clientLabel,
            servers: chosenServers,
            llmMode,
            steps: state.steps,
            balance: state.balanceMicros ?? null,
          });
          log.encore(
            "aisa connect",
            "run this any time — configure servers, switch models, connect another agent"
          );
          setTimeout(() => {
            srv.close();
            process.exit(failures > 0 ? 1 : 0);
          }, LINGER_AFTER_DONE_MS);
        } else {
          summarise(log, {
            clientId: chosenClients[0],
            clientLabel,
            servers: chosenServers,
            llmMode,
            steps: state.steps,
            balance: state.balanceMicros ?? null,
          });
          log.encore(
            "aisa connect",
            "run this any time — configure servers, switch models, connect another agent"
          );
          // Dry run: no success tab is opened, but the page (and T2's done
          // step) stays reachable for a minute so a rehearsal can be read.
          setTimeout(() => {
            srv.close();
            process.exit(0);
          }, 60_000);
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
  // Publish the address for a second invocation, and take it back on every
  // way out: normal exit, Ctrl-C, or an unhandled crash.
  writeRunLock(pageUrl);
  process.once("exit", clearRunLock);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      clearRunLock();
      process.exit(130);
    });
  }

  log.line("ok", "Found on this machine", detected.map((c) => c.label).join(", "));
  const missing = clients.filter((c) => !c.detected).map((c) => c.label);
  if (missing.length) log.record(`not found: ${missing.join(", ")}`);
  log.line("info", `${servers.length} AIsa MCP servers are live`, "pick what you need in the page");
  log.section("Open this page to choose");
  console.log(`  ${chalk.cyan(pageUrl)}`);
  if (options.open === false) {
    log.note("open the URL above in your browser to continue (Ctrl-C to cancel)");
  } else {
    log.note("opening your browser… (Ctrl-C to cancel)");
    openBrowser(pageUrl);
  }
}
