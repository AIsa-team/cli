#!/usr/bin/env node
/**
 * Default-off Quickstart Skill ablation. Not the frozen eval/cli-guidance 8-case suite.
 * Install/login/MCP are Mock E2E. Do not score until AISA_EVAL_SCORE_CLEARED=1.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractResolvedModel } from "../cli-guidance/grade.mjs";
import { parseJsonl, extractCompletedFinal } from "../cli-guidance/run.mjs";
import { PROFILE, startStub } from "../cli-guidance/stub.mjs";
import { CONDITIONS, EXPECTED_CASE_IDS, REQUESTED, gradeCase, summarizeAblation } from "./grade.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_ROOT = resolve(HERE, "../..");
const SYNTH_KEY = "aisa_eval_synthetic_key_not_real";
const TRACKED_PIDS = new Set();
const HASH_FILES = Object.freeze([
  "cases.json",
  "system-prompt.txt",
  "grade.mjs",
  "grade-checks.mjs",
  "extension.ts",
  "run.mjs",
]);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function fileSha(path) {
  return sha256(readFileSync(path));
}

function currentHashes() {
  const files = {};
  for (const name of HASH_FILES) files[name] = fileSha(join(HERE, name));
  return {
    algorithm: "sha256",
    files,
    bundle: sha256(HASH_FILES.map((n) => `${n}:${files[n]}`).join("\n")),
  };
}

function writeHashes() {
  const hashes = currentHashes();
  const payload = { ...hashes, eval_commit: git(EVAL_ROOT, ["rev-parse", "HEAD"]) };
  writeFileSync(join(HERE, "hashes.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function assertFrozenHashes() {
  const path = join(HERE, "hashes.json");
  if (!existsSync(path)) throw new Error("hashes.json missing; run with --freeze first");
  const frozen = JSON.parse(readFileSync(path, "utf8"));
  const live = currentHashes();
  if (frozen.bundle !== live.bundle) {
    throw new Error(`frozen hashes drifted\nfrozen=${frozen.bundle}\nlive=${live.bundle}`);
  }
  return frozen;
}

function git(src, args) {
  const r = spawnSync("git", ["-C", src, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function lookupOnPath(name) {
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const candidate = resolve(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

function ensureRequestedPi() {
  if (REQUESTED.pi_bin) return REQUESTED;
  const pi_bin = process.env.AISA_EVAL_PI || lookupOnPath("pi");
  if (!pi_bin) throw new Error("pi not found; set AISA_EVAL_PI to the 0.84.4 binary");
  const probe = spawnSync(pi_bin, ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`pi --version failed: ${pi_bin}`);
  const version = (probe.stdout || "").trim();
  if (version !== "0.84.4") throw new Error(`refusing Pi ${version}; expected 0.84.4`);
  REQUESTED.pi_bin = pi_bin;
  REQUESTED.pi_version = version;
  return REQUESTED;
}

function parseArgs(argv) {
  const out = {
    freeze: false,
    selfCheck: false,
    help: false,
    docs: "",
    docsSha: "",
    skill: "",
    skillSha: "",
    cliBin: "",
    cliSha: "",
    cliSrc: "",
    out: "",
    condition: "",
    caseId: "",
    concurrency: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--freeze") out.freeze = true;
    else if (a === "--self-check") out.selfCheck = true;
    else if (a === "--docs") out.docs = argv[++i];
    else if (a === "--docs-sha") out.docsSha = argv[++i];
    else if (a === "--skill") out.skill = argv[++i];
    else if (a === "--skill-sha") out.skillSha = argv[++i];
    else if (a === "--cli-bin") out.cliBin = argv[++i];
    else if (a === "--cli-sha") out.cliSha = argv[++i];
    else if (a === "--cli-src") out.cliSrc = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--condition") out.condition = argv[++i];
    else if (a === "--case") out.caseId = argv[++i];
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return out;
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
  writeFileSync(
    join(dir, "settings.json"),
    `${JSON.stringify({ packages: [], extensions: [], skills: [], defaultProjectTrust: "never" }, null, 2)}\n`
  );
  return dir;
}

function killProcessGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
}

function cleanupTrackedChildren() {
  for (const pid of TRACKED_PIDS) killProcessGroup(pid);
  TRACKED_PIDS.clear();
}

process.once("SIGINT", () => {
  cleanupTrackedChildren();
  process.exit(130);
});
process.once("SIGTERM", () => {
  cleanupTrackedChildren();
  process.exit(143);
});
process.once("exit", cleanupTrackedChildren);

function spawnAsync(cmd, args, opts, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { ...opts, stdio: opts.stdio || ["ignore", "pipe", "pipe"], detached: true });
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
    child.on("error", (err) => finish({ code: null, signal: null, stdout, stderr, spawn_error: String(err) }));
    child.on("close", (code, signal) => finish({ code, signal, stdout, stderr }));
  });
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
  for (const p of ["tmp", "xdg-config", "xdg-cache", "xdg-data", "xdg-state", "cache"]) ensureDir(join(home, p));
  const env = cliEnv(home, stubUrl, apiKey);
  for (const [k, v] of [
    ["baseUrl", stubUrl],
    ["routerUrl", stubUrl],
  ]) {
    const r = spawnSync(process.execPath, [bin, "config", "set", k, v], { env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`config set ${k} failed: ${r.stderr || r.stdout}`);
  }
}

export function buildPiArgs({ condition, terminal, skillPath, systemPrompt, extensionPath }) {
  const tools = terminal ? "read_guide,setup_action,aisa_cli" : "read_guide,setup_action";
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
    tools,
    "--no-extensions",
    "-e",
    extensionPath,
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-session",
    "--no-approve",
    "--system-prompt",
    systemPrompt,
  ];
  if (condition === "skill") args.push("--append-system-prompt", skillPath);
  return args;
}

function assertNoSkillLeak(condition, piArgs, skillPath, skillBody) {
  if (condition !== "no-skill") return;
  const joined = piArgs.join("\0");
  if (piArgs.includes("--append-system-prompt") || piArgs.includes("--skill")) {
    throw new Error("no-skill argv must not pass --skill or --append-system-prompt");
  }
  if (skillPath && joined.includes(skillPath)) throw new Error("no-skill argv contains skill path");
  if (skillBody && joined.includes(skillBody.slice(0, 80))) throw new Error("no-skill argv contains skill body");
}

function requireInputs(args) {
  for (const k of ["docs", "docsSha", "skill", "skillSha", "cliBin", "cliSha"]) {
    if (!args[k]) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  const docs = resolve(args.docs);
  const skill = resolve(args.skill);
  const cliBin = resolve(args.cliBin);
  if (!existsSync(docs)) throw new Error(`docs missing: ${docs}`);
  if (!existsSync(skill)) throw new Error(`skill missing: ${skill}`);
  if (!existsSync(cliBin)) throw new Error(`cli bin missing: ${cliBin}`);
  const docsSha = fileSha(docs);
  const skillSha = fileSha(skill);
  if (docsSha !== args.docsSha) throw new Error(`docs sha mismatch\nwant ${args.docsSha}\ngot  ${docsSha}`);
  if (skillSha !== args.skillSha) throw new Error(`skill sha mismatch\nwant ${args.skillSha}\ngot  ${skillSha}`);
  if (args.cliSrc) {
    const head = git(resolve(args.cliSrc), ["rev-parse", "HEAD"]);
    if (!head.startsWith(args.cliSha)) throw new Error(`cli HEAD ${head} does not match --cli-sha ${args.cliSha}`);
  }
  return { docs, skill, cliBin, docsSha, skillSha, cliSha: args.cliSha, skillBody: readFileSync(skill, "utf8") };
}

function frozenCliGuidanceIntact() {
  const frozen = JSON.parse(readFileSync(join(HERE, "../cli-guidance/hashes.json"), "utf8"));
  const names = Object.keys(frozen.files);
  const live = {};
  for (const name of names) live[name] = fileSha(join(HERE, "../cli-guidance", name));
  const bundle = sha256(names.map((n) => `${n}:${live[n]}`).join("\n"));
  if (bundle !== frozen.bundle) throw new Error("eval/cli-guidance frozen bundle drifted; this suite must not modify it");
  return frozen.bundle;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, limit) }, async () => {
      while (i < items.length) {
        const idx = i;
        i += 1;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

function readLedger(path) {
  if (!existsSync(path)) return [];
  return parseJsonl(readFileSync(path, "utf8")).events.filter((e) => e && e.type !== "parse_error");
}

async function runOne({ spec, condition, inputs, outRoot, hashes, scored }) {
  const caseDir = join(outRoot, "runs", condition, spec.id);
  rmSync(caseDir, { recursive: true, force: true });
  ensureDir(caseDir);
  const home = join(caseDir, "cli-home");
  const cwd = join(caseDir, "cwd");
  const sessions = join(caseDir, "sessions");
  ensureDir(home);
  ensureDir(cwd);
  ensureDir(sessions);
  const start = spec.start || {};
  const terminal = spec.terminal === true;
  const stub = terminal ? await startStub({ caseId: spec.stub_case_id || spec.id }) : null;
  const apiKey = start.authenticated ? SYNTH_KEY : "";
  try {
    if (terminal) prepareCliHome(home, inputs.cliBin, stub.url, apiKey);
    if (start.authenticated) {
      ensureDir(join(home, ".aisa"));
      writeFileSync(join(home, ".aisa", "key"), `${SYNTH_KEY}\n`, { mode: 0o600 });
    }
    const statePath = join(caseDir, "state.json");
    writeFileSync(
      statePath,
      `${JSON.stringify({ cli_installed: Boolean(start.cli_installed), authenticated: Boolean(start.authenticated) })}\n`
    );
    const ledgerPath = join(caseDir, "actions.jsonl");
    writeFileSync(ledgerPath, "");
    const piDir = isolatePiDir(caseDir);
    const systemPrompt = readFileSync(join(HERE, "system-prompt.txt"), "utf8");
    const piArgs = buildPiArgs({
      condition,
      terminal,
      skillPath: inputs.skill,
      systemPrompt,
      extensionPath: join(HERE, "extension.ts"),
    });
    assertNoSkillLeak(condition, piArgs, inputs.skill, inputs.skillBody);
    writeFileSync(join(caseDir, "pi.args.json"), `${JSON.stringify({ condition, terminal, args: piArgs }, null, 2)}\n`);
    const piEnv = piProcessEnv({
      PI_CODING_AGENT_DIR: piDir,
      PI_CODING_AGENT_SESSION_DIR: sessions,
      AISA_EVAL_BIN: inputs.cliBin,
      AISA_EVAL_LEDGER: ledgerPath,
      AISA_EVAL_HOME: home,
      AISA_EVAL_STUB: stub ? stub.url : "",
      AISA_EVAL_GUIDE: inputs.docs,
      AISA_EVAL_STATE: statePath,
      AISA_EVAL_TERMINAL: terminal ? "1" : "0",
      AISA_EVAL_MAX_CALLS: "16",
    });
    const started = new Date().toISOString();
    const result = await spawnAsync(REQUESTED.pi_bin, [...piArgs, "--", spec.prompt], { env: piEnv, cwd }, 180000);
    const finished = new Date().toISOString();
    writeFileSync(join(caseDir, "pi.stdout.jsonl"), result.stdout);
    writeFileSync(join(caseDir, "pi.stderr.txt"), result.stderr);
    const parsed = parseJsonl(result.stdout);
    const events = parsed.events;
    const resolved = extractResolvedModel(events);
    const completion = extractCompletedFinal(events, { timed_out: result.timed_out === true });
    const transport = [];
    if (result.spawn_error) transport.push({ errorMessage: result.spawn_error });
    if (completion.reason === "terminal_error") transport.push({ errorMessage: "terminal_error" });
    const runtime = {
      exit_code: result.code,
      signal: result.signal ?? null,
      timed_out: result.timed_out === true,
      parse_errors: parsed.parse_errors,
      transport_errors: transport,
    };
    const ledger = readLedger(ledgerPath);
    if (condition === "no-skill") {
      const blob = `${result.stdout}\n${JSON.stringify(ledger)}`;
      if (blob.includes(inputs.skillBody.slice(0, 120))) {
        throw new Error(`${spec.id} no-skill run contained skill body; contamination`);
      }
    }
    const pack = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
    const grade = gradeCase({
      spec,
      facts: pack.facts,
      ledger,
      httpLedger: stub ? stub.ledger : [],
      finalText: completion.completed ? completion.text : "",
      resolved,
      runtime,
    });
    const record = {
      suite: "agent-quickstart",
      condition,
      case_id: spec.id,
      started,
      finished,
      duration_ms: Date.parse(finished) - Date.parse(started),
      requested: REQUESTED,
      resolved,
      runtime,
      final_completion: completion,
      docs_sha: inputs.docsSha,
      skill_sha: inputs.skillSha,
      cli_sha: inputs.cliSha,
      eval_bundle: hashes.bundle,
      mock_e2e: ["setup_action", "login_intercept", "balance_intercept"],
      not_claimed: ["native_npx_install", "native_cli_browser_login", "native_mcp_oauth"],
      scored: scored === true,
      grade,
      final_text: completion.completed ? completion.text : "",
    };
    if (stub) writeFileSync(join(caseDir, "http.json"), `${JSON.stringify(stub.ledger, null, 2)}\n`);
    writeFileSync(join(caseDir, "grade.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    if (stub) await stub.close().catch(() => {});
  }
}

async function selfCheck(inputs, outRoot) {
  const gradeChecks = spawnSync(process.execPath, ["--test", join(HERE, "grade-checks.mjs")], { encoding: "utf8" });
  if (gradeChecks.status !== 0) throw new Error(`grade-checks failed\n${gradeChecks.stderr || gradeChecks.stdout}`);
  const frozen = frozenCliGuidanceIntact();
  const stub = await startStub({ caseId: "self-check" });
  const home = join(outRoot, "self-check-home");
  rmSync(home, { recursive: true, force: true });
  ensureDir(home);
  try {
    prepareCliHome(home, inputs.cliBin, stub.url, SYNTH_KEY);
    const env = cliEnv(home, stub.url, SYNTH_KEY);
    const version = spawnSync(process.execPath, [inputs.cliBin, "--version"], { env, encoding: "utf8" });
    const search = await spawnAsync(process.execPath, [inputs.cliBin, "search", "company profile", "--json"], { env }, 20000);
    const skillArgs = buildPiArgs({
      condition: "skill",
      terminal: true,
      skillPath: inputs.skill,
      systemPrompt: "x",
      extensionPath: join(HERE, "extension.ts"),
    });
    const noSkillArgs = buildPiArgs({
      condition: "no-skill",
      terminal: false,
      skillPath: inputs.skill,
      systemPrompt: "x",
      extensionPath: join(HERE, "extension.ts"),
    });
    assertNoSkillLeak("no-skill", noSkillArgs, inputs.skill, inputs.skillBody);
    if (!skillArgs.includes("--append-system-prompt")) throw new Error("skill condition must append the skill file");
    const ok =
      version.status === 0 &&
      search.code === 0 &&
      search.stdout.includes(PROFILE) &&
      gradeChecks.status === 0;
    const report = {
      ok,
      frozen_cli_guidance_bundle: frozen,
      hashes: currentHashes(),
      docs_sha: inputs.docsSha,
      skill_sha: inputs.skillSha,
      cli_sha: inputs.cliSha,
      version: version.stdout.trim(),
      search_status: search.code,
      skill_argv_has_append: skillArgs.includes("--append-system-prompt"),
      no_skill_argv_clean: !noSkillArgs.includes("--append-system-prompt") && !noSkillArgs.includes("--skill"),
    };
    writeFileSync(join(outRoot, "self-check.json"), `${JSON.stringify(report, null, 2)}\n`);
    if (!ok) throw new Error("self-check failed; see self-check.json");
    return report;
  } finally {
    await stub.close();
  }
}

function printHelp() {
  console.log(`Quickstart Skill ablation (default-off, Mock E2E setup). Not eval/cli-guidance.

  node eval/agent-quickstart/run.mjs --freeze
  node eval/agent-quickstart/run.mjs --self-check --docs FILE --docs-sha SHA --skill FILE --skill-sha SHA --cli-bin FILE --cli-sha SHA --cli-src DIR --out DIR

  Scored 4x2 runs stay blocked until independent review clearance:
  AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs --docs FILE --docs-sha SHA --skill FILE --skill-sha SHA --cli-bin FILE --cli-sha SHA --cli-src DIR --out DIR

  Optional: --condition skill|no-skill  --case ID  (diagnostic; scored=false)
  Pi 0.84.4, openai-codex/gpt-5.6-luna thinking low. No model fallback.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.freeze) {
    console.log(JSON.stringify(writeHashes(), null, 2));
    return;
  }
  const inputs = requireInputs(args);
  const outRoot = resolve(args.out || join(tmpdir(), "aisa-agent-quickstart-eval"));
  ensureDir(outRoot);
  if (args.selfCheck) {
    const report = await selfCheck(inputs, outRoot);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (process.env.AISA_EVAL_SCORE_CLEARED !== "1") {
    throw new Error(
      "scored Quickstart ablation is blocked until the independent reviewer clears this frozen bundle. Set AISA_EVAL_SCORE_CLEARED=1 only after that. Use --self-check while waiting. This flag is not user authentication."
    );
  }
  const hashes = assertFrozenHashes();
  ensureRequestedPi();
  frozenCliGuidanceIntact();
  const pack = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
  const conditions = args.condition ? [args.condition] : CONDITIONS;
  if (conditions.some((c) => !CONDITIONS.includes(c))) throw new Error("--condition must be skill or no-skill");
  const cases = pack.cases.filter((c) => !args.caseId || c.id === args.caseId);
  if (!cases.length) throw new Error(`no cases matched ${args.caseId}`);
  const diagnostic = Boolean(args.condition || args.caseId);
  const jobs = [];
  for (const condition of conditions) {
    for (const spec of cases) jobs.push({ spec, condition });
  }
  const scored = !diagnostic && jobs.length === 8;
  console.error(`running ${jobs.length} job(s) diagnostic=${diagnostic} scored=${scored} model=${REQUESTED.model}`);
  const rows = await mapLimit(jobs, Math.min(args.concurrency || 1, 2), (job) =>
    runOne({ spec: job.spec, condition: job.condition, inputs, outRoot, hashes, scored: false })
  );
  const identityRows = rows.map((r) => ({
    case_id: r.case_id,
    condition: r.condition,
    task_pass: r.grade.task_pass,
    safety_pass: r.grade.safety_pass,
  }));
  const complete =
    !diagnostic &&
    EXPECTED_CASE_IDS.every((id) => CONDITIONS.every((c) => identityRows.some((r) => r.case_id === id && r.condition === c)));
  const scoredFinal = complete && scored;
  for (const row of rows) {
    row.scored = scoredFinal;
    const gradePath = join(outRoot, "runs", row.condition, row.case_id, "grade.json");
    if (existsSync(gradePath)) {
      const rec = JSON.parse(readFileSync(gradePath, "utf8"));
      rec.scored = scoredFinal;
      rec.diagnostic = diagnostic;
      writeFileSync(gradePath, `${JSON.stringify(rec, null, 2)}\n`);
    }
  }
  const summary = {
    generated_at: new Date().toISOString(),
    requested: REQUESTED,
    hashes,
    docs_sha: inputs.docsSha,
    skill_sha: inputs.skillSha,
    cli_sha: inputs.cliSha,
    diagnostic,
    scored: scoredFinal,
    ablation: summarizeAblation(identityRows),
    mock_e2e: true,
    not_claimed: ["native_npx_install", "native_cli_browser_login", "native_mcp_oauth"],
    runs: rows.map((r) => ({
      condition: r.condition,
      case_id: r.case_id,
      task_pass: r.grade.task_pass,
      safety_pass: r.grade.safety_pass,
      scored: scoredFinal,
      resolved: r.resolved,
      failed: [...r.grade.checks, ...r.grade.safety].filter((c) => !c.ok).map((c) => c.id),
    })),
  };
  writeFileSync(join(outRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    "# Quickstart Skill ablation (sanitized)",
    "",
    `- runtime: Pi ${REQUESTED.pi_version}`,
    `- requested: ${REQUESTED.provider} / ${REQUESTED.model} / thinking ${REQUESTED.thinking}`,
    `- CLI SHA: ${inputs.cliSha}`,
    `- docs sha256: ${inputs.docsSha}`,
    `- skill sha256: ${inputs.skillSha}`,
    `- eval bundle: ${hashes.bundle}`,
    `- scored: ${scoredFinal} diagnostic: ${diagnostic}`,
    `- Mock E2E: install/login/MCP fixtures. Native npx/OAuth are not claimed.`,
    `- task passes: ${summary.ablation.task_passes}/${summary.ablation.n}`,
    `- safety passes: ${summary.ablation.safety_passes}/${summary.ablation.n}`,
    "",
    ...summary.runs.map(
      (r) =>
        `- ${r.condition}/${r.case_id}: task=${r.task_pass} safety=${r.safety_pass}${r.failed.length ? ` failed=${r.failed.join(",")}` : ""}`
    ),
    "",
  ].join("\n");
  writeFileSync(join(outRoot, "summary.md"), md);
  console.log(md);
  const modelMismatch = rows.some((r) => r.resolved.model && r.resolved.model !== REQUESTED.model);
  if (modelMismatch) process.exitCode = 2;
  else if (!diagnostic && !complete) process.exitCode = 1;
}

export { HASH_FILES, currentHashes, assertNoSkillLeak };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  });
}
