#!/usr/bin/env node
/**
 * 评测运行器：给定"用户目标"场景，让一个 agent 用 aisa CLI 完成任务，
 * 然后用确定性 grader 检查 plan 产物。
 *
 * 两种 agent 模式：
 * - scripted：回放场景自带的已知正确命令序列（无 LLM），用于验证 harness
 *   本身与作为人工基准；
 * - command：外部 agent 命令模板（默认 pi + DeepSeek flash——性价比高、
 *   能力偏弱的基准模型：弱模型能通过，大部分模型都能通过）。
 *
 * 用法：
 *   node eval/run.mjs                       # scripted 模式跑全部场景
 *   node eval/run.mjs --agent pi-deepseek   # 用 pi + DeepSeek 跑全部场景
 *   node eval/run.mjs --scenario s1_traffic_quote --keep
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { grade, loadLatestPlan, microsToCredits } from "./grade.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalDir, "..");
const cliEntry = join(repoRoot, "dist", "index.js");

function parseArgs(argv) {
  const args = { agent: "scripted", scenario: null, keep: false, report: null, model: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") args.agent = argv[++i];
    else if (a === "--scenario") args.scenario = argv[++i];
    else if (a === "--keep") args.keep = true;
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function loadScenarios(filterId) {
  const dir = join(evalDir, "scenarios");
  const scenarios = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")))
    .sort((a, b) => a.id.localeCompare(b.id));
  return filterId ? scenarios.filter((s) => s.id === filterId) : scenarios;
}

function loadAgent(name) {
  const path = name.endsWith(".json") ? name : join(evalDir, "agents", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** scripted 模式：回放场景自带的参考命令序列，{plan} 由第一步 create --json 捕获 */
function runScripted(scenario, planDir) {
  let planId = null;
  const transcript = [];
  for (const step of scenario.scripted_reference) {
    const argv = step.argv.map((a) => (planId ? a.replaceAll("{plan}", planId) : a));
    const result = spawnSync("node", [cliEntry, ...argv], {
      cwd: repoRoot,
      env: { ...process.env, AISA_PLAN_DIR: planDir },
      encoding: "utf-8",
      timeout: 60_000,
    });
    const exit = result.status ?? -1;
    transcript.push({ argv, exit, stdout: result.stdout, stderr: result.stderr });
    const expected = step.expect_exit ?? 0;
    if (exit !== expected) {
      return { ok: false, transcript, error: `step "aisa ${argv.join(" ")}" exited ${exit}, expected ${expected}` };
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

/** command 模式：外部 agent 一次性拿到 briefing + 目标，自己驱动 CLI */
function runCommand(agent, scenario, planDir, modelOverride) {
  const briefing = readFileSync(join(evalDir, "agent-briefing.md"), "utf-8");
  const prompt = `${briefing}\n\n## GOAL\n\n${scenario.goal}\n`;
  const model = modelOverride ?? agent.model;
  const argv = agent.argv_template.map((a) =>
    a.replaceAll("{prompt}", prompt).replaceAll("{model}", model).replaceAll("{provider}", agent.provider ?? "")
  );
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: { ...process.env, AISA_PLAN_DIR: planDir },
    encoding: "utf-8",
    timeout: (agent.timeout_seconds ?? 600) * 1000,
  });
  const transcript = [{ argv: [argv[0], "…prompt omitted…", ...argv.slice(2)], exit: result.status, stdout: result.stdout, stderr: result.stderr }];
  if (result.error) {
    return { ok: false, transcript, error: `agent process failed: ${result.error.message}` };
  }
  // agent 退出码不决定成败——一切以 plan 产物为准
  return { ok: true, transcript };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(cliEntry)) {
    console.error("dist/index.js not found — run `npm run build` first");
    process.exit(1);
  }
  const scenarios = loadScenarios(args.scenario);
  if (scenarios.length === 0) {
    console.error(`no scenario matched "${args.scenario}"`);
    process.exit(1);
  }
  const agent = args.agent === "scripted" ? { type: "scripted" } : loadAgent(args.agent);

  const results = [];
  for (const scenario of scenarios) {
    const planDir = mkdtempSync(join(tmpdir(), `aisa-eval-${scenario.id}-`));
    const started = Date.now();
    const run =
      agent.type === "scripted"
        ? runScripted(scenario, planDir)
        : runCommand(agent, scenario, planDir, args.model);
    const plan = loadLatestPlan(planDir);
    const graded = grade(plan, scenario.expect);
    const pass = run.ok !== false && graded.pass;
    results.push({
      scenario: scenario.id,
      pass,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      run_error: run.error ?? null,
      checks: graded.checks,
      plan_dir: args.keep ? planDir : null,
      transcript: args.keep ? run.transcript : undefined,
    });
    if (!args.keep) rmSync(planDir, { recursive: true, force: true });

    const mark = pass ? "PASS" : "FAIL";
    console.log(`\n[${mark}] ${scenario.id} (${results.at(-1).seconds}s) — ${scenario.title}`);
    if (run.error) console.log(`  runner: ${run.error}`);
    for (const check of graded.checks) {
      if (!check.ok || process.env.EVAL_VERBOSE) {
        console.log(`  ${check.ok ? "ok  " : "FAIL"} ${check.check}: ${check.detail}`);
      }
    }
    if (args.keep) console.log(`  plan dir kept: ${planDir}`);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} scenarios passed (agent: ${args.agent})`);
  if (args.report) {
    writeFileSync(args.report, JSON.stringify({ agent: args.agent, results }, null, 2) + "\n");
    console.log(`report written to ${args.report}`);
  }
  process.exit(passed === results.length ? 0 : 1);
}

main();
