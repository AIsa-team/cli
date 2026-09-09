import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SYNTH_KEY = "aisa_eval_synthetic_key_not_real";
const CLI_OK = new Set(["search", "schema", "quote", "call", "manifest", "whoami", "api", "balance"]);
const API_OK = new Set(["show", "list", "--help", "-h"]);
const FLAG_ONLY = new Set(["--help", "--version", "-h", "-V"]);

function allowCli(args: unknown): string | null {
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) return "args must be an array of strings";
  const argv = args as string[];
  if (argv.length === 0) return null;
  const first = argv[0];
  if (first.startsWith("-")) return FLAG_ONLY.has(first) ? null : `flag-only invocation not allowed: ${first}`;
  if (first === "login") return null;
  if (!CLI_OK.has(first)) return `command not allowed: ${first}`;
  if (first === "api") {
    const sub = argv[1];
    if (sub && !API_OK.has(sub)) return `api subcommand not allowed: ${sub}`;
  }
  return null;
}

function runCli(bin: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    const onAbort = () => child.kill("SIGKILL");
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr });
    });
  });
}

function loadState(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveState(path: string, state: Record<string, unknown>) {
  writeFileSync(path, `${JSON.stringify(state)}\n`);
}

function writeKey(home: string) {
  mkdirSync(join(home, ".aisa"), { recursive: true });
  writeFileSync(join(home, ".aisa", "key"), `${SYNTH_KEY}\n`, { mode: 0o600 });
}

function hasFlag(argv: string[], name: string) {
  return argv.some((a) => a === name || a.startsWith(`${name}=`));
}

function result(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export default function (pi: ExtensionAPI) {
  const bin = process.env.AISA_EVAL_BIN || "";
  const ledgerPath = process.env.AISA_EVAL_LEDGER || "";
  const home = process.env.AISA_EVAL_HOME || "";
  const guidePath = process.env.AISA_EVAL_GUIDE || "";
  const statePath = process.env.AISA_EVAL_STATE || "";
  const skillPath = process.env.AISA_EVAL_SKILL || "";
  const skillTiming = process.env.AISA_EVAL_SKILL_TIMING || "none";
  const terminal = process.env.AISA_EVAL_TERMINAL === "1";
  const maxCalls = Number(process.env.AISA_EVAL_MAX_CALLS || "16");
  let calls = 0;

  function record(entry: Record<string, unknown>) {
    if (ledgerPath) appendFileSync(ledgerPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  }

  function cliEnv(): NodeJS.ProcessEnv {
    return {
      HOME: home,
      USER: "eval",
      PATH: process.env.PATH,
      LANG: process.env.LANG || "C.UTF-8",
      TMPDIR: `${home}/tmp`,
      XDG_CONFIG_HOME: `${home}/xdg-config`,
      XDG_CACHE_HOME: `${home}/xdg-cache`,
      XDG_DATA_HOME: `${home}/xdg-data`,
      XDG_STATE_HOME: `${home}/xdg-state`,
      AISA_CACHE_DIR: `${home}/cache`,
      AISA_NO_UPDATE_NOTICE: "1",
      AISA_NO_BROWSER: "1",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };
  }

  pi.registerTool({
    name: "read_guide",
    label: "Read setup guide",
    description: "Read the frozen AIsa setup guide for this session. No arguments. Do not fetch URLs.",
    parameters: Type.Object({}),
    async execute() {
      calls += 1;
      if (calls > maxCalls) return result(`blocked: max ${maxCalls} tool calls reached`, { blocked: true });
      if (!guidePath || !existsSync(guidePath)) {
        record({ tool: "read_guide", ok: false });
        return result("setup guide is not configured", { ok: false });
      }
      const text = readFileSync(guidePath, "utf8");
      record({ tool: "read_guide", ok: true, bytes: text.length });
      return result(text, { ok: true, bytes: text.length });
    },
  });

  pi.registerTool({
    name: "setup_action",
    label: "Mock setup action",
    description:
      "Mock E2E fixture for install/login/MCP. action is npx_skills_add, npm_install_cli, aisa_login, or mcp_connect. Pass argv for CLI-like commands; for MCP pass url, transport, auth. Not a real install or OAuth.",
    parameters: Type.Object({
      action: Type.String(),
      argv: Type.Optional(Type.Array(Type.String())),
      url: Type.Optional(Type.String()),
      transport: Type.Optional(Type.String()),
      auth: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      calls += 1;
      const p = params as {
        action?: string;
        argv?: string[];
        url?: string;
        transport?: string;
        auth?: string;
      };
      const action = String(p.action || "");
      const argv = Array.isArray(p.argv) ? p.argv.map(String) : [];
      const state = loadState(statePath);
      let text = "";
      let details: Record<string, unknown> = { action };
      if (calls > maxCalls) return result(`blocked: max ${maxCalls} tool calls reached`, { blocked: true });
      if (action === "npx_skills_add") {
        state.skill_installs = [...(state.skill_installs || []), argv];
        const expose = skillTiming === "after_install" && skillPath && existsSync(skillPath);
        details = { action, skill_body_exposed: Boolean(expose), skill_timing: skillTiming };
        if (expose) {
          text = `Mock E2E: canonical skill install recorded. Skill body follows (not a real npx).\n\n${readFileSync(skillPath, "utf8")}`;
        } else {
          text = "Mock E2E: skill install recorded. The skill file is not loaded by this fixture.";
        }
      } else if (action === "npm_install_cli") {
        state.cli_installed = true;
        text = "Mock E2E: @aisa-one/cli is now available to aisa_cli. Not a real npm install.";
      } else if (action === "aisa_login") {
        const manual = hasFlag(argv, "--key");
        state.login_attempts = [...(state.login_attempts || []), { argv, manual_key: manual }];
        details = { action, manual_key: manual };
        if (manual) {
          text = "Mock E2E: login --key recorded. Prefer aisa login without --key.";
        } else {
          state.authenticated = true;
          writeKey(home);
          text = "Mock E2E: browser sign-in completed; CLI key stored. Not real OAuth.";
        }
      } else if (action === "mcp_connect") {
        state.mcp_attempts = [
          ...(state.mcp_attempts || []),
          { url: p.url || "", transport: p.transport || "", auth: p.auth || "" },
        ];
        details = { action, url: p.url || "", transport: p.transport || "", auth: p.auth || "" };
        text =
          "Mock E2E: MCP connector recorded. OAuth is not completed in this suite. Hand the user a browser sign-in. Do not claim AIsa is connected or return a business result.";
      } else {
        text = `unknown setup_action: ${action}`;
      }
      saveState(statePath, state);
      record({
        tool: "setup_action",
        action,
        argv,
        url: p.url || null,
        transport: p.transport || null,
        auth: p.auth || null,
        skill_body_exposed: details.skill_body_exposed === true,
        skill_timing: skillTiming,
      });
      return result(text, details);
    },
  });

  if (!terminal) return;

  pi.registerTool({
    name: "aisa_cli",
    label: "AIsa CLI",
    description: "Run the AIsa CLI. Pass argv after the binary name only (no shell).",
    parameters: Type.Object({
      args: Type.Array(Type.String(), { description: 'CLI arguments after the binary, for example ["search", "--json"]' }),
    }),
    async execute(_id, params, signal) {
      const args = (params as { args?: string[] }).args || [];
      calls += 1;
      const state = loadState(statePath);
      const deny = allowCli(args);
      const overBudget = calls > maxCalls ? `max ${maxCalls} tool calls reached` : null;
      let blocked = deny || overBudget;
      if (!blocked && !state.cli_installed) blocked = "aisa is not installed in this Mock E2E session; use setup_action npm_install_cli";
      const envKey = Boolean(process.env.AISA_API_KEY);
      if (!blocked && args[0] === "login") {
        const manual = hasFlag(args.slice(1), "--key");
        state.login_attempts = [...(state.login_attempts || []), { argv: args, manual_key: manual }];
        if (!manual) {
          state.authenticated = true;
          writeKey(home);
        }
        saveState(statePath, state);
        record({ tool: "aisa_cli", args, blocked: null, intercepted: "login", manual_key: manual, env_key: envKey });
        return result(
          manual
            ? "Mock E2E: login --key recorded. Prefer aisa login without --key."
            : "Mock E2E: browser sign-in completed; CLI key stored. Not real OAuth.",
          { intercepted: "login", manual_key: manual, env_key: envKey }
        );
      }
      if (!blocked && args[0] === "balance" && state.authenticated) {
        record({ tool: "aisa_cli", args, blocked: null, intercepted: "balance", env_key: envKey });
        return result("Mock E2E balance: 5.00 USD available (fixture, not live). exit=0", {
          intercepted: "balance",
          env_key: envKey,
        });
      }
      const unconfigured = !bin || !existsSync(bin) ? "aisa_cli is not configured" : null;
      blocked = blocked || unconfigured;
      const started = Date.now();
      let cliResult = { code: null as number | null, stdout: "", stderr: "" };
      if (!blocked) {
        cliResult = await runCli(bin, args, cliEnv(), signal);
      }
      record({
        tool: "aisa_cli",
        args,
        blocked: blocked || null,
        exit_code: cliResult.code,
        duration_ms: Date.now() - started,
        stdout: cliResult.stdout,
        stderr: cliResult.stderr,
        env_key: envKey,
        env_router: Boolean(process.env.AISA_ROUTER_BASE_URL),
      });
      if (blocked) return result(`blocked: ${blocked}`, { blocked: true, env_key: envKey });
      const text = [
        `exit=${cliResult.code ?? "null"}`,
        cliResult.stdout.trim() ? `stdout:\n${cliResult.stdout}` : "stdout: (empty)",
        cliResult.stderr.trim() ? `stderr:\n${cliResult.stderr}` : "stderr: (empty)",
      ].join("\n");
      return result(text, { exit_code: cliResult.code, env_key: envKey });
    },
  });
}
