/**
 * Plan 的本地存储：~/.aisa/plans/<plan_id>.json。
 * 测试与脚本可用 AISA_PLAN_DIR 覆盖目录。
 * 只存用户输入与 quote 快照；校验产物一律现算，避免陈旧派生状态。
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Plan } from "./model.js";

export function planDir(): string {
  return process.env.AISA_PLAN_DIR || join(homedir(), ".aisa", "plans");
}

function planPath(planId: string): string {
  return join(planDir(), `${planId}.json`);
}

const PLAN_ID_PATTERN = /^pln_[a-z0-9]{8}$/;

export function newPlanId(): string {
  return `pln_${randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0")}`;
}

export function newQuoteId(): string {
  return `qte_${randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0")}`;
}

export function nextItemId(plan: Plan): string {
  return `itm_${String(plan.nextItemSeq).padStart(2, "0")}`;
}

export function savePlan(plan: Plan): void {
  mkdirSync(planDir(), { recursive: true });
  // 先写临时文件再 rename，避免中断留下半个 JSON
  const target = planPath(plan.planId);
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(plan, null, 2) + "\n", "utf-8");
  renameSync(temp, target);
}

export function loadPlan(planId: string): Plan {
  const id = planId.trim();
  if (!PLAN_ID_PATTERN.test(id)) {
    throw new Error(`invalid plan id "${planId}" — expected pln_xxxxxxxx; list plans with: aisa plan list`);
  }
  let raw: string;
  try {
    raw = readFileSync(planPath(id), "utf-8");
  } catch {
    throw new Error(`plan "${id}" not found — list plans with: aisa plan list`);
  }
  const plan = JSON.parse(raw) as Plan;
  if (plan.schema !== 1 || plan.planId !== id) {
    throw new Error(`plan file for "${id}" is corrupt or from an incompatible version`);
  }
  return plan;
}

export function deletePlan(planId: string): void {
  const plan = loadPlan(planId); // 校验存在性与 id 格式
  unlinkSync(planPath(plan.planId));
}

export function listPlans(): Plan[] {
  let files: string[];
  try {
    files = readdirSync(planDir());
  } catch {
    return [];
  }
  const plans: Plan[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      plans.push(loadPlan(file.slice(0, -".json".length)));
    } catch {
      // 跳过损坏文件；list 是诊断入口，不应因单个坏文件失败
    }
  }
  return plans.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
