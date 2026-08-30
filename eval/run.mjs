#!/usr/bin/env node
/**
 * 评测运行器。基线是 017aad0（aisa 命令面 + natural suite），
 * 评测集和标准统一从 eval/suite.json 读。
 *
 * 用法：
 *   node eval/run.mjs                       # scripted，全部场景
 *   node eval/run.mjs --suite regression    # 只跑回归套
 *   node eval/run.mjs --suite natural       # 自然语言用户请求套
 *   node eval/run.mjs --agent pi-deepseek   # 弱模型 baseline（默认 3 trial）
 *   node eval/run.mjs --list
 *   node eval/run.mjs --export -
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { grade, loadLatestPlan } from "./grade.mjs";
import {
  DEFAULT_SUITE_PATH,
  exportSuite,
  exportSuiteSummary,
  listSuiteRows,
  loadSuite,
  passRuleFor,
  scenarioVerdict,
  scoreTrials,
  selectScenarios,
  trialsFor,
} from "./load-suite.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalDir, "..");
const cliEntry = join(repoRoot, "dist", "index.js");
const SUITE_KINDS = ["regression", "capability", "natural"];

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * 沿用 4ff8d01：每个 trial 在 PATH 上露出 `aisa`，不教 agent 跑
 * `node dist/index.js`。launcher 写在该 trial 的 plan 目录里。
 */
function evalCommandDir(planDir) {
  const binDir = join(planDir, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "aisa"),
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliEntry)} "$@"\n`,
    { mode: 0o755 }
  );
  return binDir;
}

function sandboxEnv(planDir, standards) {
  return {
    ...process.env,
    AISA_PLAN_DIR: planDir,
    AISA_API_KEY: standards.sandbox.poison_api_key,
    PATH: [evalCommandDir(planDir), process.env.PATH ?? ""].join(delimiter),
  };
}

export function parseArgs(argv) {
  const args = {
    agent: "scripted",
    scenario: null,
    suiteKind: null,
    keep: false,
    report: null,
    model: null,
    trials: null,
    list: false,
    exportPath: null,
    exportSummary: false,
    suitePath: DEFAULT_SUITE_PATH,
    transcriptsDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") args.agent = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--suite") args.suiteKind = argv[++i];
    else if (a === "--suite-file") args.suitePath = argv[++i];
    else if (a === "--keep") args.keep = true;
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--trials") args.trials = Number(argv[++i]);
    else if (a === "--list") args.list = true;
    else if (a === "--export") args.exportPath = argv[++i] ?? "-";
    else if (a === "--export-summary") args.exportSummary = true;
    else if (a === "--transcripts-dir") args.transcriptsDir = argv[++i];
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  if (args.trials != null && (!Number.isInteger(args.trials) || args.trials < 1)) {
    console.error("--trials must be an integer >= 1");
    process.exit(1);
  }
  if (args.suiteKind && !SUITE_KINDS.includes(args.suiteKind)) {
    console.error(`--suite must be ${SUITE_KINDS.join(", ")}`);
    process.exit(1);
  }
  return args;
}

function loadAgent(name) {
  const path = name.endsWith(".json") ? name : join(evalDir, "agents", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function runScripted(scenario, planDir, standards) {
  let planId = null;
  const transcript = [];
  const env = sandboxEnv(planDir, standards);
  for (const step of scenario.scripted_reference) {
    const argv = step.argv.map((a) => (planId ? a.replaceAll("{plan}", planId) : a));
    const result = spawnSync("aisa", argv, {
      cwd: repoRoot,
      env,
      encoding: "utf-8",
      timeout: 60_000,
    });
    const exit = result.status ?? -1;
    transcript.push({ argv: ["aisa", ...argv], exit, stdout: result.stdout, stderr: result.stderr });
    const expected = step.expect_exit ?? 0;
    if (exit !== expected) {
      return {
        ok: false,
        transcript,
        error: `step "aisa ${argv.join(" ")}" exited ${exit}, expected ${expected}`,
      };
    }
    if (step.capture === "plan_id") {
      try {
        planId = JSON.parse(result.stdout).plan_id;
      } catch {
        return { ok: false, transcript, error: "could not capture plan_id from create --json output" };
      }
    }
  }
  return { ok: true, transcript };
}

function runCommand(agent, scenario, planDir, standards, modelOverride) {
  const briefing = readFileSync(join(evalDir, "agent-briefing.md"), "utf-8");
  // 017aad0：用户请求放在 USER MESSAGE，不把 goal 写成 CLI 说明书
  const prompt = `${briefing}\n\n## USER MESSAGE\n\n${scenario.goal}\n`;
  const model = modelOverride ?? agent.model;
  const argv = agent.argv_template.map((a) =>
    a.replaceAll("{prompt}", prompt).replaceAll("{model}", model).replaceAll("{provider}", agent.provider ?? "")
  );
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: sandboxEnv(planDir, standards),
    encoding: "utf-8",
    timeout: (agent.timeout_seconds ?? 600) * 1000,
  });
  const transcript = [
    { argv: [argv[0], "…prompt omitted…", ...argv.slice(2)], exit: result.status, stdout: result.stdout, stderr: result.stderr },
  ];
  if (result.error) {
    return { ok: false, transcript, error: `agent process failed: ${result.error.message}` };
  }
  return { ok: true, transcript };
}

function writeTranscript(dir, scenarioId, trialIndex, payload) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${scenarioId}-t${trialIndex + 1}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function runTrial({ scenario, agent, standards, model, keep, transcriptsDir, trialIndex }) {
  const planDir = mkdtempSync(join(tmpdir(), `aisa-eval-${scenario.id}-`));
  const started = Date.now();
  const run =
    agent.type === "scripted"
      ? runScripted(scenario, planDir, standards)
      : runCommand(agent, scenario, planDir, standards, model);
  const plan = loadLatestPlan(planDir);
  const graded = grade(plan, scenario.expect);
  const pass = run.ok !== false && graded.pass;
  const seconds = Math.round((Date.now() - started) / 100) / 10;

  let transcriptPath = null;
  if (keep || !pass) {
    const dir = transcriptsDir ?? join(tmpdir(), "aisa-eval-transcripts");
    transcriptPath = writeTranscript(dir, scenario.id, trialIndex, {
      scenario: scenario.id,
      trial: trialIndex + 1,
      pass,
      run_error: run.error ?? null,
      checks: graded.checks,
      transcript: run.transcript,
      plan_dir: keep ? planDir : null,
    });
  }
  if (!keep) rmSync(planDir, { recursive: true, force: true });

  return {
    pass,
    seconds,
    run_error: run.error ?? null,
    checks: graded.checks,
    plan_dir: keep ? planDir : null,
    transcript_path: transcriptPath,
  };
}

function printScenario(result) {
  const mark = result.verdict ? "PASS" : "FAIL";
  const metrics = result.metrics;
  console.log(
    `\n[${mark}] ${result.scenario} (${result.suite}) — ${result.title}  pass@${metrics.k}=${metrics.pass_at_k} pass^${metrics.k}=${metrics.pass_hat_k} (${metrics.successes}/${metrics.k})`
  );
  for (const [index, trial] of result.trials.entries()) {
    if (result.trials.length > 1) {
      console.log(`  trial ${index + 1}: ${trial.pass ? "PASS" : "FAIL"} (${trial.seconds}s)`);
    }
    if (trial.run_error) console.log(`  runner: ${trial.run_error}`);
    for (const check of trial.checks) {
      if (!check.ok || process.env.EVAL_VERBOSE) {
        console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.check}: ${check.detail}`);
      }
    }
    if (trial.transcript_path && !trial.pass) {
      console.log(`  transcript: ${trial.transcript_path}`);
    }
    if (trial.plan_dir) console.log(`  plan dir kept: ${trial.plan_dir}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const suite = loadSuite(args.suitePath);

  if (args.list) {
    for (const row of listSuiteRows(suite)) {
      console.log(`${row.id}\t${row.suite}\t${row.title}`);
    }
    return 0;
  }
  if (args.exportSummary) {
    const text = exportSuiteSummary(suite);
    if (args.exportPath && args.exportPath !== "-") writeFileSync(args.exportPath, text);
    else process.stdout.write(text);
    return 0;
  }
  if (args.exportPath != null) {
    const text = exportSuite(suite);
    if (args.exportPath === "-") process.stdout.write(text);
    else {
      writeFileSync(args.exportPath, text);
      console.log(`suite exported to ${args.exportPath}`);
    }
    return 0;
  }

  if (!existsSync(cliEntry)) {
    console.error("dist/index.js not found — run `npm run build` first");
    return 1;
  }

  const scenarios = selectScenarios(suite, { suiteKind: args.suiteKind, scenarioId: args.scenario });
  if (scenarios.length === 0) {
    console.error(
      args.scenario
        ? `no scenario matched "${args.scenario}"`
        : `no scenarios in suite "${args.suiteKind ?? "all"}"`
    );
    return 1;
  }

  const mode = args.agent === "scripted" ? "scripted" : "agent";
  const agent = mode === "scripted" ? { type: "scripted" } : loadAgent(args.agent);
  const trials = trialsFor(suite.standards, mode, args.trials);

  const results = [];
  for (const scenario of scenarios) {
    const trialResults = [];
    for (let i = 0; i < trials; i++) {
      trialResults.push(
        runTrial({
          scenario,
          agent,
          standards: suite.standards,
          model: args.model,
          keep: args.keep,
          transcriptsDir: args.transcriptsDir,
          trialIndex: i,
        })
      );
    }
    const metrics = scoreTrials(trialResults.map((trial) => trial.pass));
    const rule = passRuleFor(suite.standards, mode, scenario.suite);
    const row = {
      scenario: scenario.id,
      suite: scenario.suite,
      title: scenario.title,
      pass_rule: rule,
      verdict: scenarioVerdict(metrics, rule),
      metrics,
      trials: trialResults,
    };
    results.push(row);
    printScenario(row);
  }

  const passed = results.filter((row) => row.verdict).length;
  const bySuite = {};
  for (const row of results) {
    bySuite[row.suite] ??= { passed: 0, total: 0 };
    bySuite[row.suite].total += 1;
    if (row.verdict) bySuite[row.suite].passed += 1;
  }
  console.log(
    `\n${passed}/${results.length} scenarios passed (agent: ${args.agent}, trials: ${trials})`
  );
  for (const [kind, counts] of Object.entries(bySuite)) {
    console.log(`  ${kind}: ${counts.passed}/${counts.total}`);
  }

  if (args.report) {
    writeFileSync(
      args.report,
      `${JSON.stringify(
        {
          suite: { name: suite.name, version: suite.version, path: args.suitePath },
          agent: args.agent,
          mode,
          trials,
          standards: suite.standards,
          results,
          summary: { passed, total: results.length, by_suite: bySuite },
        },
        null,
        2
      )}\n`
    );
    console.log(`report written to ${args.report}`);
  }

  return passed === results.length ? 0 : 1;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  process.exit(main());
}
