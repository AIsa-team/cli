import { spawn } from "node:child_process";
import { appendFileSync, existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BLOCKED = new Set([
  "login",
  "logout",
  "config",
  "update",
  "cache",
  "connect",
  "mcp",
  "install",
  "uninstall",
  "chat",
  "video",
  "tweet",
  "twitter",
  "skills",
  "completion",
  "models",
  "account",
  "balance",
  "topup",
  "usage",
]);

const ROOT_OK = new Set(["search", "schema", "quote", "call", "manifest", "whoami", "api", "run"]);
const API_OK = new Set(["search", "show", "list", "code", "--help", "-h"]);
const FLAG_ONLY = new Set(["--help", "--version", "-h", "-V"]);

function allow(args: unknown): string | null {
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    return "args must be an array of strings";
  }
  const argv = args as string[];
  if (argv.length === 0) return null;
  const first = argv[0];
  if (first.startsWith("-")) {
    return FLAG_ONLY.has(first) ? null : `flag-only invocation not allowed: ${first}`;
  }
  if (BLOCKED.has(first)) return `command not allowed: ${first}`;
  if (!ROOT_OK.has(first)) return `command not allowed: ${first}`;
  if (first === "api") {
    const sub = argv[1];
    if (!sub) return null;
    if (!API_OK.has(sub)) return `api subcommand not allowed: ${sub}`;
  }
  return null;
}

/** Only `-` (stdin) or a path inside the case scratch. Blocks grader/source/credential files. */
function fileOutsideScratch(args: string[], scratch: string): string | null {
  if (!scratch) return "case scratch is not configured";
  const root = resolve(scratch);
  for (let i = 0; i < args.length; i += 1) {
    let file: string | undefined;
    if (args[i] === "-f" || args[i] === "--file") {
      if (args[i + 1] == null) return "missing file path after -f/--file";
      file = args[i + 1];
    } else if (args[i].startsWith("--file=")) {
      file = args[i].slice("--file=".length);
    }
    if (file == null) continue;
    if (file === "-") continue;
    if (!file || file.includes("\0")) return "invalid file path";
    const resolved = isAbsolute(file) ? resolve(file) : resolve(root, file);
    const rel = relative(root, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return `file path outside case scratch: ${file}`;
    }
    try {
      const realRoot = existsSync(root) ? realpathSync(root) : root;
      const realFile = existsSync(resolved) ? realpathSync(resolved) : resolved;
      const relReal = relative(realRoot, realFile);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        return `file path outside case scratch: ${file}`;
      }
    } catch {
      return `file path outside case scratch: ${file}`;
    }
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
    const onAbort = () => {
      child.kill("SIGKILL");
    };
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

export default function (pi: ExtensionAPI) {
  const bin = process.env.AISA_EVAL_BIN || "";
  const ledgerPath = process.env.AISA_EVAL_LEDGER || "";
  const home = process.env.AISA_EVAL_HOME || "";
  const stub = process.env.AISA_EVAL_STUB || "";
  const scratch = process.env.AISA_EVAL_SCRATCH || "";
  const maxCalls = Number(process.env.AISA_EVAL_MAX_CALLS || "12");
  const apiKey = process.env.AISA_EVAL_KEY || "";
  let calls = 0;

  pi.registerTool({
    name: "aisa_cli",
    label: "AIsa CLI",
    description:
      "Run the AIsa CLI. Pass argv after the binary name only (no shell). Discover usage with [\"--help\"] or [\"manifest\"].",
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        description: "CLI arguments after the binary name, for example [\"search\", \"company profile\", \"--json\"]",
      }),
    }),
    async execute(_id, params, signal) {
      const args = (params as { args?: string[] }).args || [];
      calls += 1;
      const deny = allow(args) || fileOutsideScratch(args, scratch);
      const overBudget = calls > maxCalls ? `max ${maxCalls} CLI calls reached` : null;
      const unconfigured = !bin || !existsSync(bin) ? "aisa_cli is not configured" : null;
      const blocked = deny || overBudget || unconfigured;
      const started = Date.now();
      let result = { code: null as number | null, stdout: "", stderr: "" };
      if (!blocked) {
        const env: NodeJS.ProcessEnv = {
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
          AISA_ROUTER_BASE_URL: stub,
          AISA_NO_UPDATE_NOTICE: "1",
          AISA_NO_BROWSER: "1",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        };
        if (apiKey) env.AISA_API_KEY = apiKey;
        result = await runCli(bin, args, env, signal);
      }
      const record = {
        ts: new Date().toISOString(),
        args,
        invocation: calls,
        blocked: blocked || null,
        exit_code: result.code,
        duration_ms: Date.now() - started,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      if (ledgerPath) {
        appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`);
      }
      if (blocked) {
        return { content: [{ type: "text", text: `blocked: ${blocked}` }] };
      }
      const text = [
        `exit=${result.code ?? "null"}`,
        result.stdout.trim() ? `stdout:\n${result.stdout}` : "stdout: (empty)",
        result.stderr.trim() ? `stderr:\n${result.stderr}` : "stderr: (empty)",
      ].join("\n");
      return { content: [{ type: "text", text }] };
    },
  });
}
