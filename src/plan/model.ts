/**
 * 通用 Plan（资源事务清单）的本地数据模型。
 *
 * 铁律：Plan 是数据不是程序——没有控制流、变量绑定、输出映射。
 * `after` 只表达执行排序与失败短路，绝无数据传递；scope 依赖上游结果的
 * item 用 placeholder 表达，由上游 Agent 拿到结果后 replace 具体化。
 *
 * 本地版为 P0 预览：quote 由本地引擎计算并标注 authority=local_preview，
 * 不产生任何服务端预留。金额一律 credit micros 整数。
 */

export type ItemKind = "resource" | "placeholder";
export type OnDepFailure = "skip" | "proceed";
export type BudgetPolicy = "hard" | "advisory";

export type ScopeValue = string | number | boolean | string[];

export interface PlanItem {
  itemId: string;
  kind: ItemKind;
  /** "similarweb.traffic_engagement@1" —— 始终带版本，registry 解析后固化 */
  capability: string;
  scope?: Record<string, ScopeValue>;
  phase?: string;
  after?: string[];
  onDepFailure?: OnDepFailure;
  maxCreditMicros?: number;
  note?: string;
}

export interface Plan {
  schema: 1;
  planId: string;
  /** 乐观并发号：任何 item/预算变更 +1，使已有 quote 变 stale */
  version: number;
  status: "draft";
  intent?: string;
  budgetCreditMicros?: number;
  budgetPolicy: BudgetPolicy;
  items: PlanItem[];
  quote?: QuoteSnapshot;
  nextItemSeq: number;
  createdAt: string;
  updatedAt: string;
}

// ── 校验产物（不落盘，每次现算）──

export type GapReason =
  | "missing_required"
  | "needs_upstream_result"
  | "unverified_pricing"
  | "out_of_coverage";

export interface Gap {
  field: string;
  reason: GapReason;
  hint: string;
}

export interface ItemValidation {
  itemId: string;
  status: "valid" | "invalid" | "gaps";
  errors: string[];
  gaps: Gap[];
  warnings: string[];
  /** 进入定价公式与 manifest hash 的派生输入 */
  compiledInputs: Record<string, number>;
  /** 规范化后的 scope（默认值已填充、列表已去重）*/
  normalizedScope: Record<string, ScopeValue>;
}

export interface PlanCheckResult {
  status: "valid" | "invalid" | "gaps";
  planErrors: string[]; // plan 级问题：after 引用缺失、依赖成环等
  items: ItemValidation[];
}

// ── 报价产物（落盘到 plan.quote）──

export type CostModelKind = "exact_formula" | "bounded_response" | "fixed" | "unknown" | "placeholder";

export interface ItemCost {
  itemId: string;
  capability: string;
  costModelKind: CostModelKind;
  /** unknown/placeholder 无法估算，为 null */
  estimateCreditMicros: number | null;
  maxCreditMicros: number;
  basis: {
    display: string;
    inputs: Record<string, number | string>;
    sourceUrl: string | null;
    verifiedAt: string | null;
  };
}

export interface QuoteSnapshot {
  quoteId: string;
  planId: string;
  planVersion: number;
  /** 本地报价没有服务端权威性——消费方必须检查这个字段 */
  authority: "local_preview";
  manifestHash: string;
  status: "ready" | "over_budget";
  items: ItemCost[];
  totals: {
    estimateCreditMicros: number;
    maxCreditMicros: number;
  };
  budgetCheck: {
    withinBudget: boolean;
    budgetCreditMicros: number | null;
    headroomCreditMicros: number | null;
  };
  registryRevision: number;
  warnings: string[];
  createdAt: string;
  expiresAt: string;
}

export interface QuoteProblem {
  itemId: string | null;
  problems: string[];
}
