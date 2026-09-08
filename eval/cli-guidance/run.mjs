#!/usr/bin/env node
/**
 * Default-off real-Agent eval for CLI help/guidance.
 * Frozen cases + deterministic grader. No silent model fallback.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractResolvedModel, gradeCase, summarizeSuite } from "./grade.mjs";
import { PROFILE, startStub } from "./stub.mjs";

const BASELINE_SRC = "/tmp/aisa-cli-eval-baseline";
const BASELINE_SHA = "ec29516f41702aac6f5e26e98e53c2545c600840";
const CANDIDATE_SRC = "/Users/eddiearc/repo/worktrees/aisa-cli-guidance-help";
const CANDIDATE_SHA = "3f12d666bc7e2a20efd6e8d806969288fd2284b8";
const TRACKED_PIDS = new Set();

const HERE = dirname(fileURLToPath(import.meta.url));
const REQUESTED = Object.freeze({
  runtime: "pi",
  pi_bin: process.env.AISA_EVAL_PI || "/Users/eddiearc/.local/bin/pi",
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  thinking: "low",
});
const SYNTH_KEY = "aisa_eval_synthetic_key_not_real";
const EVAL_ROOT = resolve(HERE, "../..");
/** Bound scoring inputs. hashes.json is the lockfile and must stay outside this list. */
const HASH_FILES = Object.freeze([
  "cases.json",
  "system-prompt.txt",
  "grade.mjs",
  "grade-checks.mjs",
  "stub.mjs",
  "extension.ts",
  "run.mjs",
]);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function fileSha(name) {
  return sha256(readFileSync(join(HERE, name)));
}

function assertHashFilesContract() {
  if (HASH_FILES.includes("hashes.json")) {
    throw new Error("hashes.json must not be listed in HASH_FILES");
  }
}

function evalIdentity() {
  return {
    commit: git(EVAL_ROOT, ["rev-parse", "HEAD"]),
    dirty: Boolean(git(EVAL_ROOT, ["status", "--porcelain"])),
  };
}

function currentHashes({ requireAll = false } = {}) {
  assertHashFilesContract();
  const files = {};
  const missing = [];
  for (const name of HASH_FILES) {
    const path = join(HERE, name);
    if (!existsSync(path)) {
      missing.push(name);
      continue;
    }
    files[name] = fileSha(name);
  }
  if (requireAll && missing.length) {
    throw new Error(
      `HASH_FILES missing (${missing.join(", ")}). Freeze only after grade.mjs and grade-checks.mjs are cherry-picked (not *.test.mjs).`
    );
  }
  const present = HASH_FILES.filter((n) => files[n]);
  return {
    algorithm: "sha256",
    files,
    missing,
    bundle: sha256(present.map((n) => `${n}:${files[n]}`).join("\n")),
  };
}

function writeHashes() {
  const hashes = currentHashes({ requireAll: true });
  const evalId = evalIdentity();
  const payload = {
    algorithm: hashes.algorithm,
    files: hashes.files,
    bundle: hashes.bundle,
    eval_commit: evalId.commit,
  };
  writeFileSync(join(HERE, "hashes.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function assertFrozenHashes() {
  const path = join(HERE, "hashes.json");
  if (!existsSync(path)) {
    throw new Error("hashes.json missing; run with --freeze first");
  }
  const frozen = JSON.parse(readFileSync(path, "utf8"));
  const live = currentHashes({ requireAll: true });
  if (frozen.bundle !== live.bundle) {
    throw new Error(`frozen hashes drifted\nfrozen=${frozen.bundle}\nlive=${live.bundle}`);
  }
  return frozen;
}

function boundIds(source, hashes) {
  const evalId = evalIdentity();
  return {
    cli_sha: source?.sha || null,
    cli_src: source?.src || null,
    cli_tarball_sha256: source?.tarball_sha256 || null,
    eval_commit: evalId.commit,
    eval_dirty: evalId.dirty,
    eval_bundle: hashes?.bundle || null,
  };
}

function parseArgs(argv) {
  const out = {
    freeze: false,
    selfCheck: false,
    modelPreflight: false,
    suite: "baseline",
    src: "",
    expectSha: "",
    out: "",
    concurrency: 1,
    repeats: null,
    caseId: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--freeze") out.freeze = true;
    else if (a === "--self-check") out.selfCheck = true;
    else if (a === "--model-preflight") out.modelPreflight = true;
    else if (a === "--suite") out.suite = argv[++i];
    else if (a === "--src") out.src = argv[++i];
    else if (a === "--expect-sha") out.expectSha = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--repeats") out.repeats = Number(argv[++i]);
    else if (a === "--case") out.caseId = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${r.stderr || r.stdout}`);
  }
  return r;
}

function git(src, args) {
  return sh("git", ["-C", src, ...args]).stdout.trim();
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function isolatePiDir(root) {
  const dir = join(root, "pi-agent");
  ensureDir(dir);
  const authSrc = join(process.env.HOME || "", ".pi/agent/auth.json");
  if (!existsSync(authSrc)) throw new Error(`missing Pi auth.json at ${authSrc}`);
  const authDst = join(dir, "auth.json");
  if (!existsSync(authDst)) symlinkSync(authSrc, authDst);
  writeFileSync(join(dir, "settings.json"), `${JSON.stringify({ packages: [], extensions: [], defaultProjectTrust: "never" }, null, 2)}\n`);
  return dir;
}

function installFromSrc(src, dest, expectSha) {
  const sha = git(src, ["rev-parse", "HEAD"]);
  if (expectSha && !sha.startsWith(expectSha)) {
    throw new Error(`source HEAD ${sha} does not match --expect-sha ${expectSha}`);
  }
  const dirty = git(src, ["status", "--porcelain"]);
  const packDir = join(dest, "pack");
  const prefix = join(dest, "prefix");
  const bin = join(prefix, "node_modules", "@aisa-one", "cli", "dist", "index.js");
  const metaPath = join(dest, "install-meta.json");
  if (existsSync(metaPath) && existsSync(bin)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (meta.sha === sha && existsSync(meta.tarball) && existsSync(meta.bin)) {
      return meta;
    }
  }
  ensureDir(packDir);
  ensureDir(prefix);
  let packCwd = src;
  if (dirty) {
    const packRoot = join(dest, "src");
    rmSync(packRoot, { recursive: true, force: true });
    ensureDir(packRoot);
    const tar = spawnSync("git", ["-C", src, "archive", sha], { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
    if (tar.status !== 0) throw new Error(`git archive failed: ${String(tar.stderr)}`);
    const unpack = spawnSync("tar", ["-x", "-C", packRoot], { input: tar.stdout });
    if (unpack.status !== 0) throw new Error(`tar failed: ${String(unpack.stderr)}`);
    const lock = existsSync(join(packRoot, "package-lock.json"));
    sh("npm", [lock ? "ci" : "install"], { cwd: packRoot, stdio: "inherit" });
    packCwd = packRoot;
  }
  const packed = sh("npm", ["pack", "--pack-destination", packDir], { cwd: packCwd });
  const packLines = packed.stdout.trim().split("\n").filter(Boolean);
  const tgzName = packLines[packLines.length - 1].trim();
  const tgz = join(packDir, tgzName);
  sh("npm", ["install", "--omit=dev", "--prefix", prefix, tgz], { stdio: "inherit" });
  if (!existsSync(bin)) throw new Error(`installed CLI missing: ${bin}`);
  const pkg = JSON.parse(readFileSync(join(prefix, "node_modules", "@aisa-one", "cli", "package.json"), "utf8"));
  const meta = {
    sha,
    expect_sha: expectSha || sha,
    dirty: Boolean(dirty),
    tarball: tgz,
    tarball_sha256: sha256(readFileSync(tgz)),
    bin,
    version: pkg.version,
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

function killProcessGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function cleanupTrackedChildren() {
  for (const pid of TRACKED_PIDS) killProcessGroup(pid);
  TRACKED_PIDS.clear();
}

function onParentStop() {
  cleanupTrackedChildren();
}

process.once("SIGINT", () => {
  onParentStop();
  process.exit(130);
});
process.once("SIGTERM", () => {
  onParentStop();
  process.exit(143);
});
process.once("exit", onParentStop);

function spawnAsync(cmd, args, opts, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      ...opts,
      stdio: opts.stdio || ["ignore", "pipe", "pipe"],
      detached: true,
    });
    if (child.pid) TRACKED_PIDS.add(child.pid);
    let stdout = "";
    let stderr = "";
    let timed_out = false;
    let settled = false;
    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => {
        stdout += c;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c) => {
        stderr += c;
      });
    }
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid) TRACKED_PIDS.delete(child.pid);
      resolvePromise({ ...payload, timed_out, pid: child.pid });
    };
    const timer = setTimeout(() => {
      timed_out = true;
      killProcessGroup(child.pid);
    }, timeoutMs);
    child.on("error", (err) => {
      finish({ code: null, signal: null, stdout, stderr, spawn_error: String(err) });
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, stdout, stderr });
    });
  });
}

function parseJsonl(text) {
  const events = [];
  const parse_errors = [];
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch (err) {
      const rec = { line: i + 1, error: String(err), raw: line };
      parse_errors.push(rec);
      events.push({ type: "parse_error", line: rec.line, raw: line, error: rec.error });
    }
  }
  return { events, parse_errors };
}

function lastAssistantMessageEnd(events) {
  let last = null;
  for (const ev of events) {
    if (ev?.type === "message_end" && ev.message?.role === "assistant") last = ev;
  }
  return last;
}

function messageText(msg) {
  const parts = [];
  for (const c of msg.content || []) {
    if (c && (c.type === "text" || c.type === "output_text") && c.text) parts.push(c.text);
  }
  return parts.join("\n");
}

function terminalTransportErrors(events) {
  const last = lastAssistantMessageEnd(events);
  if (!last) return [];
  const msg = last.message || {};
  const err = msg.errorMessage || msg.error;
  if (msg.stopReason === "error" || err) {
    return [
      {
        stopReason: msg.stopReason || null,
        errorMessage: err || "assistant error",
        empty_final: !String(messageText(msg)).trim(),
      },
    ];
  }
  return [];
}

/**
 * Only the terminal successful assistant completion counts as final.
 * Do not fall back to earlier text, error bodies, or extractFinalText
 * (that helper also keeps error-message content).
 */
function extractCompletedFinal(events, { timed_out = false } = {}) {
  if (timed_out) return { text: "", completed: false, reason: "timed_out" };
  const last = lastAssistantMessageEnd(events);
  if (!last) return { text: "", completed: false, reason: "no_assistant_message_end" };
  const msg = last.message || {};
  if (msg.stopReason === "error" || msg.errorMessage || msg.error) {
    return { text: "", completed: false, reason: "terminal_error" };
  }
  const text = messageText(msg);
  if (!String(text).trim()) {
    return { text: "", completed: false, reason: "empty_or_tool_only_final" };
  }
  return { text, completed: true, reason: "ok" };
}

function readCliLedger(path) {
  if (!existsSync(path)) return { events: [], parse_errors: [] };
  const parsed = parseJsonl(readFileSync(path, "utf8"));
  return {
    events: parsed.events.filter((e) => e && e.type !== "parse_error"),
    parse_errors: parsed.parse_errors,
  };
}

function piProcessEnv(overlay) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AISA_")) delete env[key];
  }
  return Object.assign(env, overlay);
}

function cliEnv(home, stubUrl, apiKey) {
  const env = {
    HOME: home,
    USER: "eval",
    PATH: process.env.PATH,
    LANG: process.env.LANG || "C.UTF-8",
    TMPDIR: join(home, "tmp"),
    XDG_CONFIG_HOME: join(home, "xdg-config"),
    XDG_CACHE_HOME: join(home, "xdg-cache"),
    XDG_DATA_HOME: join(home, "xdg-data"),
    XDG_STATE_HOME: join(home, "xdg-state"),
    AISA_CACHE_DIR: join(home, "cache"),
    AISA_ROUTER_BASE_URL: stubUrl,
    AISA_NO_UPDATE_NOTICE: "1",
    AISA_NO_BROWSER: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  if (apiKey) env.AISA_API_KEY = apiKey;
  return env;
}

function prepareCliHome(home, bin, stubUrl, apiKey) {
  for (const p of ["tmp", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "cache"]) {
    ensureDir(join(home, p));
  }
  const env = cliEnv(home, stubUrl, apiKey);
  const setBase = spawnSync(process.execPath, [bin, "config", "set", "baseUrl", stubUrl], {
    env,
    encoding: "utf8",
  });
  const setRouter = spawnSync(process.execPath, [bin, "config", "set", "routerUrl", stubUrl], {
    env,
    encoding: "utf8",
  });
  if (setBase.status !== 0) throw new Error(`config set baseUrl failed: ${setBase.stderr || setBase.stdout}`);
  if (setRouter.status !== 0) throw new Error(`config set routerUrl failed: ${setRouter.stderr || setRouter.stdout}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function runOneCase({ spec, facts, bin, outRoot, suite, runIndex, hashes, source }) {
  const caseDir = join(outRoot, "runs", suite, spec.id, `r${runIndex}`);
  rmSync(caseDir, { recursive: true, force: true });
  ensureDir(caseDir);
  const home = join(caseDir, "cli-home");
  const cwd = join(caseDir, "cwd");
  const sessions = join(caseDir, "sessions");
  ensureDir(home);
  ensureDir(cwd);
  ensureDir(sessions);
  const stub = await startStub({ caseId: spec.id });
  const apiKey = spec.auth === "none" ? "" : SYNTH_KEY;
  try {
    prepareCliHome(home, bin, stub.url, apiKey);
    const ledgerPath = join(caseDir, "cli.jsonl");
    writeFileSync(ledgerPath, "");
    const piDir = isolatePiDir(caseDir);
    const prompt = spec.prompt;
    const systemPrompt = readFileSync(join(HERE, "system-prompt.txt"), "utf8");
    const piEnv = piProcessEnv({
      PI_CODING_AGENT_DIR: piDir,
      PI_CODING_AGENT_SESSION_DIR: sessions,
      AISA_EVAL_BIN: bin,
      AISA_EVAL_LEDGER: ledgerPath,
      AISA_EVAL_HOME: home,
      AISA_EVAL_STUB: stub.url,
      AISA_EVAL_SCRATCH: cwd,
      AISA_EVAL_MAX_CALLS: "12",
      ...(apiKey ? { AISA_EVAL_KEY: apiKey } : {}),
    });
    const args = [
      "--print",
      "--mode",
      "json",
      "--provider",
      REQUESTED.provider,
      "--model",
      REQUESTED.model,
      "--thinking",
      REQUESTED.thinking,
      "--no-builtin-tools",
      "--tools",
      "aisa_cli",
      "--no-extensions",
      "-e",
      join(HERE, "extension.ts"),
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-session",
      "--no-approve",
      "--system-prompt",
      systemPrompt,
      "--",
      prompt,
    ];
    const started = new Date().toISOString();
    const result = await spawnAsync(REQUESTED.pi_bin, args, { env: piEnv, cwd }, 120000);
    const finished = new Date().toISOString();
    writeFileSync(join(caseDir, "pi.stdout.jsonl"), result.stdout);
    writeFileSync(join(caseDir, "pi.stderr.txt"), result.stderr);
    const parsed = parseJsonl(result.stdout);
    writeFileSync(
      join(caseDir, "parse_errors.jsonl"),
      parsed.parse_errors.map((e) => JSON.stringify(e)).join("\n") + (parsed.parse_errors.length ? "\n" : "")
    );
    writeFileSync(
      join(caseDir, "pi.events.jsonl"),
      parsed.events.map((e) => JSON.stringify(e)).join("\n") + (parsed.events.length ? "\n" : "")
    );
    const events = parsed.events;
    const resolved = extractResolvedModel(events);
    const transport = terminalTransportErrors(events);
    if (result.spawn_error) transport.push({ errorMessage: result.spawn_error });
    const completion = extractCompletedFinal(events, { timed_out: result.timed_out === true });
    const runtime = {
      exit_code: result.code,
      signal: result.signal ?? null,
      timed_out: result.timed_out === true,
      parse_errors: parsed.parse_errors,
      transport_errors: transport,
    };
    writeFileSync(join(caseDir, "runtime.json"), `${JSON.stringify({ ...runtime, parse_error_count: parsed.parse_errors.length, transport_error_count: transport.length, final_completion: completion }, null, 2)}\n`);
    const cliParsed = readCliLedger(ledgerPath);
    writeFileSync(
      join(caseDir, "cli_parse_errors.jsonl"),
      cliParsed.parse_errors.map((e) => JSON.stringify(e)).join("\n") + (cliParsed.parse_errors.length ? "\n" : "")
    );
    writeFileSync(join(caseDir, "http.json"), `${JSON.stringify(stub.ledger, null, 2)}\n`);
    const grade = gradeCase({
      spec,
      facts,
      cliLedger: cliParsed.events,
      httpLedger: stub.ledger,
      finalText: completion.completed ? completion.text : "",
      resolved,
      runtime: {
        exit_code: runtime.exit_code,
        signal: runtime.signal,
        timed_out: runtime.timed_out,
        parse_errors: runtime.parse_errors,
        transport_errors: runtime.transport_errors,
      },
    });
    const ids = boundIds(source, hashes);
    const record = {
      suite,
      case_id: spec.id,
      run_index: runIndex,
      started,
      finished,
      requested: REQUESTED,
      resolved,
      runtime,
      final_completion: completion,
      source,
      hashes: { bundle: hashes.bundle },
      cli_sha: ids.cli_sha,
      eval_commit: ids.eval_commit,
      eval_dirty: ids.eval_dirty,
      eval_bundle: ids.eval_bundle,
      scored: false,
      grade,
      final_text: completion.completed ? completion.text : "",
    };
    writeFileSync(join(caseDir, "grade.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    await stub.close().catch(() => {});
  }
}

async function selfCheck(bin, outRoot) {
  const stubChecks = spawnSync(process.execPath, ["--test", join(HERE, "stub-checks.mjs")], {
    encoding: "utf8",
  });
  if (stubChecks.status !== 0) {
    throw new Error(`stub-checks failed\n${stubChecks.stderr || stubChecks.stdout}`);
  }
  const stub = await startStub({ caseId: "self-check" });
  const home = join(outRoot, "self-check-home");
  rmSync(home, { recursive: true, force: true });
  ensureDir(home);
  try {
    prepareCliHome(home, bin, stub.url, SYNTH_KEY);
    const env = cliEnv(home, stub.url, SYNTH_KEY);
    const version = spawnSync(process.execPath, [bin, "--version"], { env, encoding: "utf8" });
    const help = spawnSync(process.execPath, [bin, "search", "--help"], { env, encoding: "utf8" });
    // Must be async: spawnSync in this process blocks the stub event loop.
    const search = await spawnAsync(
      process.execPath,
      [bin, "search", "company profile", "--json"],
      { env },
      20000
    );
    const ok =
      version.status === 0 &&
      help.status === 0 &&
      search.code === 0 &&
      search.stdout.includes(PROFILE) &&
      stubChecks.status === 0;
    writeFileSync(
      join(outRoot, "self-check.json"),
      `${JSON.stringify(
        {
          ok,
          stub: stub.url,
          version: { status: version.status, stdout: version.stdout.trim() },
          help_status: help.status,
          stub_checks: { status: stubChecks.status },
          search: {
            status: search.code,
            signal: search.signal,
            stdout: search.stdout.slice(0, 400),
            stderr: search.stderr.slice(0, 400),
          },
        },
        null,
        2
      )}\n`
    );
    if (!ok) throw new Error("self-check failed; see self-check.json");
    return true;
  } finally {
    await stub.close();
  }
}

async function modelPreflight(outRoot) {
  const dir = join(outRoot, "pilot", "model-preflight");
  rmSync(dir, { recursive: true, force: true });
  ensureDir(join(dir, "cwd"));
  const piDir = isolatePiDir(dir);
  const env = piProcessEnv({
    PI_CODING_AGENT_DIR: piDir,
    PI_CODING_AGENT_SESSION_DIR: join(dir, "sessions"),
  });
  ensureDir(env.PI_CODING_AGENT_SESSION_DIR);
  const result = await spawnAsync(
    REQUESTED.pi_bin,
    [
      "--print",
      "--mode",
      "json",
      "--provider",
      REQUESTED.provider,
      "--model",
      REQUESTED.model,
      "--thinking",
      REQUESTED.thinking,
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-session",
      "--no-approve",
      "--",
      "Reply with exactly PING and nothing else.",
    ],
    { env, cwd: join(dir, "cwd") },
    60000
  );
  writeFileSync(join(dir, "pi.stdout.jsonl"), result.stdout);
  writeFileSync(join(dir, "pi.stderr.txt"), result.stderr);
  const parsed = parseJsonl(result.stdout);
  writeFileSync(join(dir, "parse_errors.jsonl"), parsed.parse_errors.map((e) => JSON.stringify(e)).join("\n") + (parsed.parse_errors.length ? "\n" : ""));
  const completion = extractCompletedFinal(parsed.events, { timed_out: result.timed_out === true });
  const resolved = extractResolvedModel(parsed.events);
  const transport = terminalTransportErrors(parsed.events);
  const runtime = {
    exit_code: result.code,
    signal: result.signal ?? null,
    timed_out: result.timed_out === true,
    parse_errors: parsed.parse_errors,
    transport_errors: transport,
  };
  const ok =
    result.code === 0 &&
    !result.timed_out &&
    parsed.parse_errors.length === 0 &&
    transport.length === 0 &&
    resolved.provider === REQUESTED.provider &&
    resolved.model === REQUESTED.model &&
    completion.completed === true &&
    String(completion.text).trim().length > 0;
  const evalId = evalIdentity();
  const report = {
    ok,
    requested: REQUESTED,
    resolved,
    runtime,
    final_completion: completion,
    final_text: completion.completed ? completion.text : "",
    eval_commit: evalId.commit,
    eval_dirty: evalId.dirty,
  };
  writeFileSync(join(dir, "preflight.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!ok) throw new Error(`model preflight failed; nonempty final required. See ${join(dir, "preflight.json")}`);
  return report;
}

function printHelp() {
  console.log(`Default-off Agent eval (frozen cases, no model fallback)

  node eval/cli-guidance/run.mjs --freeze
  node eval/cli-guidance/run.mjs --model-preflight --out /tmp/aisa-cli-guidance-eval
  node eval/cli-guidance/run.mjs --suite baseline --src ${BASELINE_SRC} --expect-sha ${BASELINE_SHA} --out /tmp/aisa-cli-guidance-eval
  node eval/cli-guidance/run.mjs --suite candidate --src ${CANDIDATE_SRC} --expect-sha ${CANDIDATE_SHA} --out /tmp/aisa-cli-guidance-eval --concurrency 2

  Rebuilt baseline must use the detached source ${BASELINE_SRC} @ ${BASELINE_SHA}.
  Alignment PR HEAD is now ${CANDIDATE_SHA}; --src alignment --expect-sha ec29516 fails closed.
  Frozen HASH_FILES include run.mjs and grade-checks.mjs (not *.test.mjs, not hashes.json).
  Scored suites stay blocked until AISA_EVAL_SCORE_CLEARED=1 after grader cherry-pick and reviewer clearance.
  --self-check        pack/install + stub + real CLI probes only (no model)
  --model-preflight   real Luna completion; requires nonempty successful final
  --case <id>         run one frozen case (still blocked without clearance)
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.freeze) {
    if (!existsSync(join(HERE, "grade-checks.mjs"))) {
      throw new Error(
        "do not --freeze yet: grade-checks.mjs is not in this branch. Wait for the reviewed grader cherry-pick (standalone node:test file, not *.test.mjs)."
      );
    }
    const hashes = writeHashes();
    console.log(JSON.stringify(hashes, null, 2));
    return;
  }
  if (args.modelPreflight) {
    const report = await modelPreflight(resolve(args.out || join(tmpdir(), "aisa-cli-guidance-eval")));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const scoreCleared = process.env.AISA_EVAL_SCORE_CLEARED === "1";
  if (!args.selfCheck && !scoreCleared) {
    throw new Error(
      "scored suites are blocked until the independent reviewer clears this frozen bundle and root authorizes 8+16. Set AISA_EVAL_SCORE_CLEARED=1 only after that. Use --self-check or --model-preflight while waiting."
    );
  }
  let hashes;
  if (args.selfCheck && !scoreCleared) {
    const live = currentHashes({ requireAll: false });
    const frozenPath = join(HERE, "hashes.json");
    const frozen = existsSync(frozenPath) ? JSON.parse(readFileSync(frozenPath, "utf8")) : null;
    hashes = { ...live, drifted: !frozen || frozen.bundle !== live.bundle, frozen_bundle: frozen?.bundle || null };
    if (hashes.drifted) {
      console.error("self-check: frozen hashes drifted; re-freeze the runtime files before review");
    }
  } else {
    hashes = assertFrozenHashes();
  }
  if (!args.src) throw new Error("--src is required");
  if (!args.expectSha) throw new Error("--expect-sha is required so source IDs stay exact");
  if (!existsSync(REQUESTED.pi_bin)) throw new Error(`pi not found: ${REQUESTED.pi_bin}`);
  const piVer = sh(REQUESTED.pi_bin, ["--version"]).stdout.trim();
  if (piVer !== "0.84.4") {
    throw new Error(`refusing unrequested Pi version ${piVer}; expected 0.84.4`);
  }
  const suite = args.suite;
  if (suite !== "baseline" && suite !== "candidate") throw new Error("--suite must be baseline or candidate");
  if (suite === "baseline" && resolve(args.src) !== resolve(BASELINE_SRC)) {
    throw new Error(
      `baseline --src must be ${BASELINE_SRC} (detached ${BASELINE_SHA}); alignment PR HEAD is now ${CANDIDATE_SHA} and --src alignment --expect-sha ec29516 fails closed`
    );
  }
  if (suite === "candidate" && resolve(args.src) !== resolve(CANDIDATE_SRC)) {
    throw new Error(`candidate --src must be ${CANDIDATE_SRC} @ ${CANDIDATE_SHA}`);
  }
  const repeats = args.repeats ?? (suite === "baseline" ? 1 : 2);
  const concurrency = suite === "baseline" ? 1 : Math.min(args.concurrency || 2, 2);
  const outRoot = resolve(args.out || join(tmpdir(), "aisa-cli-guidance-eval"));
  ensureDir(outRoot);
  const installDir = join(outRoot, "install", suite);
  console.error(`installing ${suite} from ${args.src} @ ${args.expectSha}`);
  const source = { ...installFromSrc(args.src, installDir, args.expectSha), src: resolve(args.src) };
  const ids = boundIds(source, hashes);
  writeFileSync(
    join(outRoot, `${suite}-source.json`),
    `${JSON.stringify({ ...source, ...ids, requested: REQUESTED, pi_version: piVer, hashes }, null, 2)}\n`
  );
  await selfCheck(source.bin, join(outRoot, suite === "baseline" ? "baseline-self" : "candidate-self"));
  if (args.selfCheck) {
    console.log(JSON.stringify({ ok: true, source, hashes, ids, pi_version: piVer }, null, 2));
    return;
  }
  const spec = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
  const cases = spec.cases.filter((c) => !args.caseId || c.id === args.caseId);
  if (cases.length === 0) throw new Error(`no cases matched ${args.caseId}`);
  const jobs = [];
  for (const c of cases) {
    for (let r = 1; r <= repeats; r += 1) jobs.push({ spec: c, runIndex: r });
  }
  console.error(`running ${jobs.length} ${suite} job(s), concurrency ${concurrency}, model ${REQUESTED.model}`);
  const rows = await mapLimit(jobs, concurrency, (job) =>
    runOneCase({
      spec: job.spec,
      facts: spec.facts,
      bin: source.bin,
      outRoot,
      suite,
      runIndex: job.runIndex,
      hashes,
      source,
    })
  );
  const summary = {
    generated_at: new Date().toISOString(),
    requested: REQUESTED,
    pi_version: piVer,
    hashes,
    source,
    cli_sha: ids.cli_sha,
    eval_commit: ids.eval_commit,
    eval_dirty: ids.eval_dirty,
    eval_bundle: ids.eval_bundle,
    suite: summarizeSuite(
      rows.map((r) => ({
        case_id: r.case_id,
        task_pass: r.grade.task_pass,
        safety_pass: r.grade.safety_pass,
      })),
      { suite, repeats, threshold: { task_passes: 14 } }
    ),
    runs: rows.map((r) => ({
      case_id: r.case_id,
      run_index: r.run_index,
      task_pass: r.grade.task_pass,
      safety_pass: r.grade.safety_pass,
      resolved: r.resolved,
      failed_checks: [...r.grade.checks, ...r.grade.safety].filter((c) => !c.ok),
    })),
  };
  writeFileSync(join(outRoot, `${suite}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    `# ${suite} Agent eval (sanitized)`,
    "",
    `- runtime: Pi ${piVer}`,
    `- requested: ${REQUESTED.provider} / ${REQUESTED.model} / thinking ${REQUESTED.thinking}`,
    `- CLI source SHA: ${ids.cli_sha} (${source.version}) dirty=${source.dirty} src=${source.src}`,
    `- tarball sha256: ${source.tarball_sha256 || "unrecorded"}`,
    `- eval commit: ${ids.eval_commit} dirty=${ids.eval_dirty}`,
    `- eval bundle: ${ids.eval_bundle}`,
    `- task passes: ${summary.suite.task_passes}/${summary.suite.n}`,
    `- safety passes: ${summary.suite.safety_passes}/${summary.suite.n}`,
    `- every case has a task pass: ${summary.suite.every_case_has_task_pass}`,
    `- observed sample only`,
    "",
    ...summary.runs.map(
      (r) =>
        `- ${r.case_id} r${r.run_index}: task=${r.task_pass} safety=${r.safety_pass} model=${r.resolved.model || "unresolved"}${
          r.failed_checks.length ? ` failed=${r.failed_checks.map((c) => c.id).join(",")}` : ""
        }`
    ),
    "",
  ].join("\n");
  writeFileSync(join(outRoot, `${suite}-summary.md`), md);
  console.log(md);
  if (rows.some((r) => r.resolved.model && r.resolved.model !== REQUESTED.model)) {
    process.exitCode = 2;
  }
}

export { HASH_FILES, parseJsonl, extractCompletedFinal, boundIds, currentHashes };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  });
}
