/**
 * 评测集加载器：suite.json 是评测集 + 评分标准的唯一事实源。
 * 修改场景或标准只改那一个文件，再用 --export / --list 导出。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evalDir = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SUITE_PATH = join(evalDir, "suite.json");

const SUITE_KINDS = new Set(["regression", "capability", "natural"]);
const PASS_RULES = new Set(["pass_at_k", "pass_hat_k"]);

export function loadSuite(path = DEFAULT_SUITE_PATH) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    throw new Error(`failed to read eval suite ${path}: ${error.message}`);
  }
  const errors = validateSuite(raw);
  if (errors.length > 0) {
    throw new Error(`invalid eval suite ${path}:\n  - ${errors.join("\n  - ")}`);
  }
  return raw;
}

export function validateSuite(suite) {
  const errors = [];
  if (suite?.version !== 1) errors.push("version must be 1");
  if (!suite?.name) errors.push("name is required");
  if (!suite?.standards?.grading) errors.push("standards.grading is required");
  if (!suite?.standards?.sandbox) errors.push("standards.sandbox is required");
  if (!suite?.standards?.metrics) errors.push("standards.metrics is required");
  if (suite?.standards?.sandbox?.invoke !== "aisa") {
    errors.push("standards.sandbox.invoke must be \"aisa\" (customer-facing command)");
  }
  if (!suite?.standards?.sandbox?.poison_api_key) {
    errors.push("standards.sandbox.poison_api_key is required");
  }

  const metrics = suite?.standards?.metrics ?? {};
  for (const mode of ["scripted", "agent"]) {
    const block = metrics[mode];
    if (!block) {
      errors.push(`standards.metrics.${mode} is required`);
      continue;
    }
    if (!Number.isInteger(block.trials) || block.trials < 1) {
      errors.push(`standards.metrics.${mode}.trials must be an integer >= 1`);
    }
    if (mode === "scripted" && !PASS_RULES.has(block.pass_rule)) {
      errors.push(`standards.metrics.scripted.pass_rule must be pass_at_k or pass_hat_k`);
    }
    if (mode === "agent") {
      const rules = block.pass_rule;
      if (typeof rules === "string") {
        if (!PASS_RULES.has(rules)) errors.push("standards.metrics.agent.pass_rule is invalid");
      } else if (rules && typeof rules === "object") {
        for (const kind of SUITE_KINDS) {
          if (!PASS_RULES.has(rules[kind])) {
            errors.push(`standards.metrics.agent.pass_rule.${kind} must be pass_at_k or pass_hat_k`);
          }
        }
      } else {
        errors.push("standards.metrics.agent.pass_rule is required");
      }
    }
  }

  if (!Array.isArray(suite?.scenarios) || suite.scenarios.length === 0) {
    errors.push("scenarios must be a non-empty array");
    return errors;
  }

  const seen = new Set();
  for (const [index, scenario] of suite.scenarios.entries()) {
    const prefix = `scenarios[${index}]`;
    if (!scenario?.id) errors.push(`${prefix}.id is required`);
    else if (seen.has(scenario.id)) errors.push(`duplicate scenario id "${scenario.id}"`);
    else seen.add(scenario.id);
    if (!SUITE_KINDS.has(scenario?.suite)) {
      errors.push(`${prefix} (${scenario?.id ?? "?"}).suite must be regression or capability`);
    }
    if (!scenario?.title) errors.push(`${prefix}.title is required`);
    if (!scenario?.goal) errors.push(`${prefix}.goal is required`);
    if (!scenario?.expect || typeof scenario.expect !== "object") {
      errors.push(`${prefix}.expect is required`);
    }
    if (!Array.isArray(scenario?.scripted_reference) || scenario.scripted_reference.length === 0) {
      errors.push(`${prefix}.scripted_reference must be a non-empty array`);
    } else {
      const captures = scenario.scripted_reference.filter((step) => step.capture === "plan_id");
      if (captures.length !== 1) {
        errors.push(`${prefix}.scripted_reference must capture plan_id exactly once`);
      }
      for (const [stepIndex, step] of scenario.scripted_reference.entries()) {
        if (!Array.isArray(step?.argv) || step.argv.length === 0) {
          errors.push(`${prefix}.scripted_reference[${stepIndex}].argv is required`);
        }
      }
    }
  }
  return errors;
}

export function selectScenarios(suite, { suiteKind = null, scenarioId = null } = {}) {
  let selected = suite.scenarios;
  if (suiteKind) {
    selected = selected.filter((scenario) => scenario.suite === suiteKind);
  }
  if (scenarioId) {
    selected = selected.filter((scenario) => scenario.id === scenarioId);
  }
  return selected;
}

export function listSuiteRows(suite) {
  return suite.scenarios.map((scenario) => ({
    id: scenario.id,
    suite: scenario.suite,
    title: scenario.title,
  }));
}

/** 把评测集导出成稳定、可提交的 JSON 文本（按 id 排序场景，方便 diff / 分享） */
export function exportSuite(suite) {
  const copy = structuredClone(suite);
  copy.scenarios = [...copy.scenarios].sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify(copy, null, 2)}\n`;
}

export function exportSuiteSummary(suite) {
  const rows = listSuiteRows(suite);
  const lines = [
    `# ${suite.name} v${suite.version}`,
    "",
    suite.description,
    "",
    "| id | suite | title |",
    "|---|---|---|",
    ...rows.map((row) => `| ${row.id} | ${row.suite} | ${row.title} |`),
    "",
  ];
  return lines.join("\n");
}

export function scoreTrials(trialPasses) {
  const k = trialPasses.length;
  const successes = trialPasses.filter(Boolean).length;
  return {
    k,
    successes,
    pass_rate: k === 0 ? 0 : successes / k,
    pass_at_k: successes >= 1,
    pass_hat_k: k > 0 && successes === k,
  };
}

export function passRuleFor(standards, mode, suiteKind) {
  const block = standards.metrics[mode];
  if (mode === "scripted") return block.pass_rule;
  if (typeof block.pass_rule === "string") return block.pass_rule;
  return block.pass_rule[suiteKind];
}

export function scenarioVerdict(metrics, rule) {
  return Boolean(metrics[rule]);
}

export function trialsFor(standards, mode, override) {
  if (override != null) return override;
  return standards.metrics[mode].trials;
}
