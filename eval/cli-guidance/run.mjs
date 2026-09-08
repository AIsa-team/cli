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
import { fileURLToPath } from "node:url";
import { extractFinalText, extractResolvedModel, gradeCase, summarizeSuite } from "./grade.mjs";
import { PROFILE, startStub } from "./stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REQUESTED = Object.freeze({
  runtime: "pi",
  pi_bin: process.env.AISA_EVAL_PI || "/Users/eddiearc/.local/bin/pi",
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  thinking: "low",
});
const SYNTH_KEY = "aisa_eval_synthetic_key_not_real";
const HASH_FILES = ["cases.json", "system-prompt.txt", "grade.mjs", "stub.mjs", "extension.ts"];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function fileSha(name) {
  return sha256(readFileSync(join(HERE, name)));
}

function currentHashes() {
  const files = {};
  for (const name of HASH_FILES) files[name] = fileSha(name);
  return {
    algorithm: "sha256",
    files,
    bundle: sha256(HASH_FILES.map((n) => `${n}:${files[n]}`).join("\n")),
  };
}

function writeHashes() {
  const hashes = currentHashes();
  writeFileSync(join(HERE, "hashes.json"), `${JSON.stringify(hashes, null, 2)}\n`);
  return hashes;
}

function assertFrozenHashes() {
  const path = join(HERE, "hashes.json");
  if (!existsSync(path)) {
    throw new Error("hashes.json missing; run with --freeze first");
  }
  const frozen = JSON.parse(readFileSync(path, "utf8"));
  const live = currentHashes();
  if (frozen.bundle !== live.bundle) {
    throw new Error(`frozen hashes drifted\nfrozen=${frozen.bundle}\nlive=${live.bundle}`);
  }
  return frozen;
}

function parseArgs(argv) {
  const out = {
    freeze: false,
    selfCheck: false,
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

function spawnAsync(cmd, args, opts, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { ...opts, stdio: opts.stdio || ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
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
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function parseJsonl(text) {
  const events = [];
  for (const line of text.split(/\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ type: "parse_error", raw: line.slice(0, 400) });
    }
  }
  return events;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return parseJsonl(readFileSync(path, "utf8"));
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
    const events = parseJsonl(result.stdout);
    const resolved = extractResolvedModel(events);
    if (resolved.model && resolved.model !== REQUESTED.model) {
      throw new Error(`refusing silent model fallback: requested ${REQUESTED.model}, resolved ${resolved.model}`);
    }
    if (resolved.provider && resolved.provider !== REQUESTED.provider) {
      throw new Error(`refusing silent provider fallback: requested ${REQUESTED.provider}, resolved ${resolved.provider}`);
    }
    const finalText = extractFinalText(events);
    const cliLedger = readJsonl(ledgerPath);
    writeFileSync(join(caseDir, "http.json"), `${JSON.stringify(stub.ledger, null, 2)}\n`);
    const grade = gradeCase({
      spec,
      facts,
      cliLedger,
      httpLedger: stub.ledger,
      finalText,
      resolved,
    });
    const record = {
      suite,
      case_id: spec.id,
      run_index: runIndex,
      started,
      finished,
      exit_code: result.code,
      signal: result.signal,
      requested: REQUESTED,
      resolved,
      source,
      hashes: { bundle: hashes.bundle },
      grade,
      final_text: finalText,
    };
    writeFileSync(join(caseDir, "grade.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    await stub.close();
  }
}

async function selfCheck(bin, outRoot) {
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
      search.stdout.includes(PROFILE);
    writeFileSync(
      join(outRoot, "self-check.json"),
      `${JSON.stringify(
        {
          ok,
          stub: stub.url,
          version: { status: version.status, stdout: version.stdout.trim() },
          help_status: help.status,
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

function printHelp() {
  console.log(`Default-off Agent eval (frozen cases, no model fallback)

  node eval/cli-guidance/run.mjs --freeze
  node eval/cli-guidance/run.mjs --suite baseline --src <worktree> --expect-sha <sha> --out /tmp/aisa-cli-guidance-eval
  node eval/cli-guidance/run.mjs --suite candidate --src <worktree> --expect-sha <sha> --out /tmp/aisa-cli-guidance-eval --concurrency 2

  --self-check   pack/install + stub + real CLI probes only (no model)
  --case <id>    run one frozen case
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.freeze) {
    const hashes = writeHashes();
    console.log(JSON.stringify(hashes, null, 2));
    return;
  }
  const hashes = assertFrozenHashes();
  if (!args.src) throw new Error("--src is required");
  if (!args.expectSha) throw new Error("--expect-sha is required so source IDs stay exact");
  if (!existsSync(REQUESTED.pi_bin)) throw new Error(`pi not found: ${REQUESTED.pi_bin}`);
  const piVer = sh(REQUESTED.pi_bin, ["--version"]).stdout.trim();
  if (piVer !== "0.84.4") {
    throw new Error(`refusing unrequested Pi version ${piVer}; expected 0.84.4`);
  }
  const suite = args.suite;
  if (suite !== "baseline" && suite !== "candidate") throw new Error("--suite must be baseline or candidate");
  const repeats = args.repeats ?? (suite === "baseline" ? 1 : 2);
  const concurrency = suite === "baseline" ? 1 : Math.min(args.concurrency || 2, 2);
  const outRoot = resolve(args.out || join(tmpdir(), "aisa-cli-guidance-eval"));
  ensureDir(outRoot);
  const installDir = join(outRoot, "install", suite);
  console.error(`installing ${suite} from ${args.src} @ ${args.expectSha}`);
  const source = installFromSrc(args.src, installDir, args.expectSha);
  writeFileSync(join(outRoot, `${suite}-source.json`), `${JSON.stringify({ ...source, requested: REQUESTED, pi_version: piVer, hashes }, null, 2)}\n`);
  await selfCheck(source.bin, join(outRoot, suite === "baseline" ? "baseline-self" : "candidate-self"));
  if (args.selfCheck) {
    console.log(JSON.stringify({ ok: true, source, hashes, pi_version: piVer }, null, 2));
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
    `- source: ${source.sha} (${source.version}) dirty=${source.dirty}`,
    `- tarball sha256: ${source.tarball_sha256 || "unrecorded"}`,
    `- hashes.bundle: ${hashes.bundle}`,
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

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
