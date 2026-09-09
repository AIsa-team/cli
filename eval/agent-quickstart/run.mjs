#!/usr/bin/env node
/**
 * Default-off Quickstart Skill ablation. Not eval/cli-guidance.
 * Setup/login/MCP are Mock E2E. Do not launch Pi until AISA_EVAL_SCORE_CLEARED=1.
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
import { extractCompletedFinal, parseJsonl } from "../cli-guidance/run.mjs";
import { PROFILE, startStub } from "../cli-guidance/stub.mjs";
import { CONDITIONS, REQUESTED, gradeCase } from "./grade.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNTH_KEY = "aisa_eval_synthetic_key_not_real";
const KIDS = new Set();

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitHead(src) {
  const r = spawnSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git rev-parse failed\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function findPi() {
  if (REQUESTED.pi_bin) return REQUESTED;
  const fromEnv = process.env.AISA_EVAL_PI;
  let pi_bin = fromEnv || null;
  if (!pi_bin) {
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      if (!dir) continue;
      const candidate = resolve(dir, "pi");
      try {
        accessSync(candidate, fsConstants.X_OK);
        pi_bin = candidate;
        break;
      } catch {
        /* next */
      }
    }
  }
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
    selfCheck: false,
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
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--self-check") out.selfCheck = true;
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
  if (!existsSync(join(dir, "auth.json"))) symlinkSync(authSrc, join(dir, "auth.json"));
  writeFileSync(
    join(dir, "settings.json"),
    `${JSON.stringify({ packages: [], extensions: [], skills: [], defaultProjectTrust: "never" }, null, 2)}\n`
  );
  return dir;
}

function killPid(pid) {
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

process.on("exit", () => {
  for (const pid of KIDS) killPid(pid);
});

function runProcess(cmd, args, opts, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true });
    if (child.pid) KIDS.add(child.pid);
    let stdout = "";
    let stderr = "";
    let timed_out = false;
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
      timed_out = true;
      killPid(child.pid);
    }, timeoutMs);
    const done = (extra) => {
      clearTimeout(timer);
      if (child.pid) KIDS.delete(child.pid);
      resolvePromise({ stdout, stderr, timed_out, ...extra });
    };
    child.on("error", (err) => done({ code: null, signal: null, spawn_error: String(err) }));
    child.on("close", (code, signal) => done({ code, signal }));
  });
}

function stripAisaEnv(overlay) {
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
  for (const key of ["baseUrl", "routerUrl"]) {
    const r = spawnSync(process.execPath, [bin, "config", "set", key, stubUrl], { env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`config set ${key} failed: ${r.stderr || r.stdout}`);
  }
}

export function buildPiArgs({ condition, terminal, skillPath, systemPrompt, extensionPath }) {
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
    terminal ? "read_guide,setup_action,aisa_cli" : "read_guide,setup_action",
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

export function assertNoSkillLeak(condition, piArgs, skillPath, skillBody) {
  if (condition !== "no-skill") return;
  if (piArgs.includes("--append-system-prompt") || piArgs.includes("--skill")) {
    throw new Error("no-skill argv must not pass --skill or --append-system-prompt");
  }
  const joined = piArgs.join("\0");
  if (skillPath && joined.includes(skillPath)) throw new Error("no-skill argv contains skill path");
  if (skillBody && joined.includes(skillBody.slice(0, 80))) throw new Error("no-skill argv contains skill body");
}

function requireInputs(args) {
  for (const k of ["docs", "docsSha", "skill", "skillSha", "cliBin", "cliSha"]) {
    if (!args[k]) throw new Error(`missing --${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  const docs = resolve(args.docs);
  const skill = resolve(args.skill);
  const cliBin = resolve(args.cliBin);
  for (const [path, label] of [
    [docs, "docs"],
    [skill, "skill"],
    [cliBin, "cli bin"],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} missing: ${path}`);
  }
  const docsSha = sha256File(docs);
  const skillSha = sha256File(skill);
  if (docsSha !== args.docsSha) throw new Error(`docs sha mismatch\nwant ${args.docsSha}\ngot  ${docsSha}`);
  if (skillSha !== args.skillSha) throw new Error(`skill sha mismatch\nwant ${args.skillSha}\ngot  ${skillSha}`);
  if (args.cliSrc) {
    const src = resolve(args.cliSrc);
    const ancestor = spawnSync("git", ["-C", src, "merge-base", "--is-ancestor", args.cliSha, "HEAD"]);
    if (ancestor.status !== 0) {
      throw new Error(`--cli-sha ${args.cliSha} is not an ancestor of ${src} HEAD ${gitHead(src)}`);
    }
  }
  return { docs, skill, cliBin, docsSha, skillSha, cliSha: args.cliSha, skillBody: readFileSync(skill, "utf8") };
}

function readLedger(path) {
  if (!existsSync(path)) return [];
  return parseJsonl(readFileSync(path, "utf8")).events.filter((e) => e && e.type !== "parse_error");
}

async function runOne({ spec, condition, inputs, outRoot, facts }) {
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
    const systemPrompt = readFileSync(join(HERE, "system-prompt.txt"), "utf8");
    const piArgs = buildPiArgs({
      condition,
      terminal,
      skillPath: inputs.skill,
      systemPrompt,
      extensionPath: join(HERE, "extension.ts"),
    });
    assertNoSkillLeak(condition, piArgs, inputs.skill, inputs.skillBody);
    const result = await runProcess(
      REQUESTED.pi_bin,
      [...piArgs, "--", spec.prompt],
      {
        cwd,
        env: stripAisaEnv({
          PI_CODING_AGENT_DIR: isolatePiDir(caseDir),
          PI_CODING_AGENT_SESSION_DIR: sessions,
          AISA_EVAL_BIN: inputs.cliBin,
          AISA_EVAL_LEDGER: ledgerPath,
          AISA_EVAL_HOME: home,
          AISA_EVAL_STUB: stub ? stub.url : "",
          AISA_EVAL_GUIDE: inputs.docs,
          AISA_EVAL_STATE: statePath,
          AISA_EVAL_TERMINAL: terminal ? "1" : "0",
          AISA_EVAL_MAX_CALLS: "16",
        }),
      },
      180000
    );
    const parsed = parseJsonl(result.stdout);
    const resolved = extractResolvedModel(parsed.events);
    const completion = extractCompletedFinal(parsed.events, { timed_out: result.timed_out === true });
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
    if (condition === "no-skill" && `${result.stdout}${JSON.stringify(ledger)}`.includes(inputs.skillBody.slice(0, 120))) {
      throw new Error(`${spec.id} no-skill run contained skill body`);
    }
    writeFileSync(join(caseDir, "pi.stdout.jsonl"), result.stdout);
    writeFileSync(join(caseDir, "pi.stderr.txt"), result.stderr);
    if (stub) writeFileSync(join(caseDir, "http.json"), `${JSON.stringify(stub.ledger, null, 2)}\n`);
    const record = {
      condition,
      case_id: spec.id,
      requested: REQUESTED,
      resolved,
      runtime,
      docs_sha: inputs.docsSha,
      skill_sha: inputs.skillSha,
      cli_sha: inputs.cliSha,
      mock_e2e: true,
      grade: gradeCase({
        spec,
        facts,
        ledger,
        httpLedger: stub ? stub.ledger : [],
        finalText: completion.completed ? completion.text : "",
        resolved,
        runtime,
      }),
      final_text: completion.completed ? completion.text : "",
    };
    writeFileSync(join(caseDir, "grade.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  } finally {
    if (stub) await stub.close().catch(() => {});
  }
}

async function selfCheck(inputs, outRoot) {
  const gradeChecks = spawnSync(process.execPath, ["--test", join(HERE, "grade-checks.mjs")], { encoding: "utf8" });
  if (gradeChecks.status !== 0) throw new Error(`grade-checks failed\n${gradeChecks.stderr || gradeChecks.stdout}`);
  const stub = await startStub({ caseId: "self-check" });
  const home = join(outRoot, "self-check-home");
  rmSync(home, { recursive: true, force: true });
  ensureDir(home);
  try {
    prepareCliHome(home, inputs.cliBin, stub.url, SYNTH_KEY);
    const env = cliEnv(home, stub.url, SYNTH_KEY);
    const version = spawnSync(process.execPath, [inputs.cliBin, "--version"], { env, encoding: "utf8" });
    const search = await runProcess(process.execPath, [inputs.cliBin, "search", "company profile", "--json"], { env }, 20000);
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
    const ok = version.status === 0 && search.code === 0 && search.stdout.includes(PROFILE);
    const report = {
      ok,
      docs_sha: inputs.docsSha,
      skill_sha: inputs.skillSha,
      cli_sha: inputs.cliSha,
      version: version.stdout.trim(),
      search_status: search.code,
    };
    writeFileSync(join(outRoot, "self-check.json"), `${JSON.stringify(report, null, 2)}\n`);
    if (!ok) throw new Error("self-check failed; see self-check.json");
    return report;
  } finally {
    await stub.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Quickstart Skill ablation (default-off). Not eval/cli-guidance.

  node eval/agent-quickstart/run.mjs --self-check --docs FILE --docs-sha SHA --skill FILE --skill-sha SHA --cli-bin FILE --cli-sha SHA --cli-src DIR --out DIR
  AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs --docs FILE --docs-sha SHA --skill FILE --skill-sha SHA --cli-bin FILE --cli-sha SHA --cli-src DIR --out DIR
`);
    return;
  }
  const inputs = requireInputs(args);
  const outRoot = resolve(args.out || join(tmpdir(), "aisa-agent-quickstart-eval"));
  ensureDir(outRoot);
  if (args.selfCheck) {
    console.log(JSON.stringify(await selfCheck(inputs, outRoot), null, 2));
    return;
  }
  if (process.env.AISA_EVAL_SCORE_CLEARED !== "1") {
    throw new Error("Pi runs are blocked until review clearance. Use --self-check, or set AISA_EVAL_SCORE_CLEARED=1 after review. Not user authentication.");
  }
  findPi();
  const pack = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
  const conditions = args.condition ? [args.condition] : CONDITIONS;
  if (conditions.some((c) => !CONDITIONS.includes(c))) throw new Error("--condition must be skill or no-skill");
  const cases = pack.cases.filter((c) => !args.caseId || c.id === args.caseId);
  if (!cases.length) throw new Error(`no cases matched ${args.caseId}`);
  const rows = [];
  for (const condition of conditions) {
    for (const spec of cases) {
      rows.push(await runOne({ spec, condition, inputs, outRoot, facts: pack.facts }));
    }
  }
  const summary = {
    requested: REQUESTED,
    docs_sha: inputs.docsSha,
    skill_sha: inputs.skillSha,
    cli_sha: inputs.cliSha,
    mock_e2e: true,
    runs: rows.map((r) => ({
      condition: r.condition,
      case_id: r.case_id,
      task_pass: r.grade.task_pass,
      safety_pass: r.grade.safety_pass,
      resolved: r.resolved,
      failed: [...r.grade.checks, ...r.grade.safety].filter((c) => !c.ok).map((c) => c.id),
    })),
  };
  writeFileSync(join(outRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    summary.runs
      .map((r) => `${r.condition}/${r.case_id} task=${r.task_pass} safety=${r.safety_pass}${r.failed.length ? ` ${r.failed.join(",")}` : ""}`)
      .join("\n")
  );
  if (rows.some((r) => r.resolved.model && r.resolved.model !== REQUESTED.model)) process.exitCode = 2;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exit(1);
  });
}
