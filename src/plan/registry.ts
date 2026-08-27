/**
 * 能力注册表（本地 v0）。
 *
 * 这是未来服务端 Capability Registry 的本地快照占位：报价引擎只信这里的
 * 合约，绝不读 live catalog 的 `pricing.normal`（后者会把动态计费渲染成 0）。
 * 所有 verified 条目的定价规则均于 2026-08-27 对照公开产品页人工核实：
 * https://aisa.one/api/similarweb
 *
 * 成本模型故意只有四种封闭形态（对应服务端 Metered V2 estimator 的组件白
 * 名单），不提供开放表达式——每个条目在编译期即可给出成本上界。
 */

export const REGISTRY_REVISION = 1;
export const REGISTRY_VERIFIED_AT = "2026-08-27";

export const CREDIT_MICROS = 1_000_000;

/** 成本模型三态 + 固定价。金额一律用 credit micros 整数，杜绝浮点。 */
export type CostModel =
  | {
      /** 报价 = base × ∏(派生输入)，estimate == max */
      kind: "exact_formula";
      baseCreditMicros: number;
      productInputs: string[];
      display: string;
    }
  | {
      /** 响应驱动但有 provider 硬上限：max = rate × cap，estimate 按 cap 保守取值 */
      kind: "bounded_response";
      rateCreditMicros: number;
      capUnit: "row";
      cap: number;
      display: string;
    }
  | { kind: "fixed"; creditMicros: number; display: string }
  | {
      /** 定价未核实：报价时必须由调用方提供 item 级 max_credits，否则拒绝 */
      kind: "unknown";
      display: string;
    };

export type ScopeFieldType =
  | "domain"
  | "month"
  | "enum"
  | "integer"
  | "boolean"
  | "string"
  | "string_list"
  | "country";

export interface ScopeField {
  name: string;
  type: ScopeFieldType;
  required: boolean;
  default?: string | number | boolean;
  values?: string[]; // enum 取值
  min?: number;
  max?: number;
  maxItems?: number; // string_list 上限
  itemPattern?: RegExp; // string_list 单项格式
  description: string;
}

export interface CapabilityContract {
  capabilityId: string;
  version: number;
  title: string;
  binding: { provider: string; endpoint: string; method: string };
  scopeSchema: ScopeField[];
  costModel: CostModel;
  chargePolicy: "success_only";
  dataContract: {
    coverage: string[];
    freshness: string;
    granularity: string[];
    knownLimits: string[];
  };
  verification: {
    status: "verified" | "catalog_only" | "docs_only" | "deprecated";
    verifiedAt?: string;
    sources: string[];
  };
  /**
   * 从规范化 scope 派生进入定价公式的输入（如 metrics_count）。
   * 返回 errors 表示跨字段校验失败。确定性纯函数，不做任何 IO。
   */
  deriveInputs?: (scope: Record<string, unknown>) => {
    inputs: Record<string, number>;
    errors: string[];
  };
}

const SIMILARWEB_PRODUCT_URL = "https://aisa.one/api/similarweb";
const TRAFFIC_ENGAGEMENT_DOCS_URL =
  "https://aisa.one/docs/api-reference/similarweb/get_similarweb-website-traffic-engagement";

const DOMAIN_FIELD: ScopeField = {
  name: "domain",
  type: "domain",
  required: true,
  description: "Target website hostname, e.g. openai.com",
};

/** 含首尾的月桶数；start/end 已由 schema 校验为 YYYY-MM */
function monthlyBuckets(start: string, end: string): { buckets: number; error?: string } {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const startIndex = sy * 12 + sm;
  const endIndex = ey * 12 + em;
  if (endIndex < startIndex) {
    return { buckets: 0, error: "scope.end: must be the same month as or later than scope.start" };
  }
  return { buckets: endIndex - startIndex + 1 };
}

export const REGISTRY: CapabilityContract[] = [
  {
    capabilityId: "similarweb.traffic_engagement",
    version: 1,
    title: "Similarweb Traffic & Engagement",
    binding: { provider: "similarweb", endpoint: "website/traffic-engagement", method: "GET" },
    scopeSchema: [
      DOMAIN_FIELD,
      {
        name: "metrics",
        type: "string_list",
        required: true,
        maxItems: 10,
        itemPattern: /^[a-z][a-z0-9_]*$/i,
        description: "Comma-separated metric names, e.g. visits,average_visit_duration",
      },
      {
        name: "country",
        type: "country",
        required: false,
        default: "world",
        description: "One country code such as us, or world",
      },
      { name: "start", type: "month", required: true, description: "Start month (YYYY-MM)" },
      { name: "end", type: "month", required: true, description: "End month (YYYY-MM)" },
      {
        name: "granularity",
        type: "enum",
        required: false,
        default: "monthly",
        values: ["monthly"],
        description: "P0 supports monthly only",
      },
      {
        name: "main_domain_only",
        type: "boolean",
        required: false,
        default: true,
        description: "Exclude subdomains",
      },
    ],
    costModel: {
      kind: "exact_formula",
      baseCreditMicros: 1 * CREDIT_MICROS,
      productInputs: ["metrics_count", "countries_count", "time_buckets"],
      display: "1 credit x metrics x countries x monthly time buckets",
    },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["website traffic & engagement", "desktop + mobile web"],
      freshness: "monthly",
      granularity: ["monthly"],
      knownLimits: [
        "weekly/daily buckets are not independently verified and are not offered here",
        "low-traffic domains may return empty data (charged only on success)",
      ],
    },
    verification: {
      status: "verified",
      verifiedAt: REGISTRY_VERIFIED_AT,
      sources: [SIMILARWEB_PRODUCT_URL, TRAFFIC_ENGAGEMENT_DOCS_URL],
    },
    deriveInputs: (scope): { inputs: Record<string, number>; errors: string[] } => {
      const metrics = scope.metrics as string[];
      const result = monthlyBuckets(scope.start as string, scope.end as string);
      if (result.error) return { inputs: {}, errors: [result.error] };
      return {
        inputs: {
          metrics_count: metrics.length,
          countries_count: 1, // 本地 v0 每个 item 一个 country；多 country 拆多个 item
          time_buckets: result.buckets,
        },
        errors: [],
      };
    },
  },
  {
    capabilityId: "similarweb.demographics",
    version: 1,
    title: "Similarweb Demographics",
    binding: { provider: "similarweb", endpoint: "website/demographics", method: "GET" },
    scopeSchema: [DOMAIN_FIELD],
    costModel: { kind: "fixed", creditMicros: 8 * CREDIT_MICROS, display: "8 credits per call (fixed)" },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["audience age and gender split"],
      freshness: "monthly",
      granularity: ["snapshot"],
      knownLimits: ["charged only on success"],
    },
    verification: {
      status: "verified",
      verifiedAt: REGISTRY_VERIFIED_AT,
      sources: [SIMILARWEB_PRODUCT_URL],
    },
  },
  {
    capabilityId: "similarweb.technologies",
    version: 1,
    title: "Similarweb Website Technologies",
    binding: { provider: "similarweb", endpoint: "website/technologies", method: "GET" },
    scopeSchema: [DOMAIN_FIELD],
    costModel: { kind: "fixed", creditMicros: 10 * CREDIT_MICROS, display: "10 credits per call (fixed)" },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["technology stack detected on the website"],
      freshness: "monthly",
      granularity: ["snapshot"],
      knownLimits: ["charged only on success"],
    },
    verification: {
      status: "verified",
      verifiedAt: REGISTRY_VERIFIED_AT,
      sources: [SIMILARWEB_PRODUCT_URL],
    },
  },
  {
    capabilityId: "similarweb.referrals",
    version: 1,
    title: "Similarweb Referrals",
    binding: { provider: "similarweb", endpoint: "website/referrals", method: "GET" },
    scopeSchema: [
      DOMAIN_FIELD,
      {
        name: "country",
        type: "country",
        required: false,
        default: "world",
        description: "One country code such as us, or world",
      },
    ],
    costModel: {
      kind: "bounded_response",
      rateCreditMicros: 3 * CREDIT_MICROS,
      capUnit: "row",
      cap: 20,
      display: "3 credits per returned row, provider caps at 20 rows",
    },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["top incoming referral websites"],
      freshness: "monthly",
      granularity: ["snapshot"],
      knownLimits: ["row count is response-driven; the 20-row cap bounds spend"],
    },
    verification: {
      status: "verified",
      verifiedAt: REGISTRY_VERIFIED_AT,
      sources: [SIMILARWEB_PRODUCT_URL],
    },
  },
  {
    capabilityId: "similarweb.similar_sites",
    version: 1,
    title: "Similarweb SimilarSites",
    binding: { provider: "similarweb", endpoint: "website/similar-sites", method: "GET" },
    scopeSchema: [DOMAIN_FIELD],
    costModel: {
      kind: "bounded_response",
      rateCreditMicros: 2 * CREDIT_MICROS,
      capUnit: "row",
      cap: 20,
      display: "2 credits per returned row, provider caps at 20 rows",
    },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["websites with similar audience and content"],
      freshness: "monthly",
      granularity: ["snapshot"],
      knownLimits: ["row count is response-driven; the 20-row cap bounds spend"],
    },
    verification: {
      status: "verified",
      verifiedAt: REGISTRY_VERIFIED_AT,
      sources: [SIMILARWEB_PRODUCT_URL],
    },
  },
  {
    capabilityId: "similarweb.website_keywords",
    version: 1,
    title: "Similarweb Website Keywords",
    binding: { provider: "similarweb", endpoint: "search/website-keywords", method: "GET" },
    scopeSchema: [DOMAIN_FIELD],
    costModel: {
      kind: "bounded_response",
      rateCreditMicros: 130_000, // 0.13 credit/row
      capUnit: "row",
      cap: 20,
      display: "0.13 credits per returned row, provider caps at 20 rows",
    },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["organic and paid keywords driving traffic to the site"],
      freshness: "monthly",
      granularity: ["snapshot"],
      knownLimits: ["row count is response-driven; the 20-row cap bounds spend"],
    },
    verification: {
      status: "verified",
      verifiedAt: REGISTRY_VERIFIED_AT,
      sources: [SIMILARWEB_PRODUCT_URL],
    },
  },
  {
    // 示例性的未核实条目：走 unknown 成本路径，报价必须由调用方给上限。
    capabilityId: "web_search.tavily",
    version: 1,
    title: "Web Search (Tavily)",
    binding: { provider: "web-search", endpoint: "tavily", method: "GET" },
    scopeSchema: [
      { name: "query", type: "string", required: true, description: "Search query" },
      {
        name: "limit",
        type: "integer",
        required: false,
        default: 10,
        min: 1,
        max: 20,
        description: "Max results (1-20)",
      },
    ],
    costModel: {
      kind: "unknown",
      display: "pricing not publicly verified — your per-item cap is the only spend bound",
    },
    chargePolicy: "success_only",
    dataContract: {
      coverage: ["general web search results"],
      freshness: "live",
      granularity: ["query"],
      knownLimits: ["pricing is not publicly verified for this capability"],
    },
    verification: { status: "catalog_only", sources: [] },
  },
];

/** 按 "id" 或 "id@version" 解析能力；错误文案面向调用方，英文。 */
export function findCapability(ref: string): { contract?: CapabilityContract; error?: string } {
  const trimmed = ref.trim();
  const atIndex = trimmed.lastIndexOf("@");
  const id = atIndex > 0 ? trimmed.slice(0, atIndex) : trimmed;
  const versionText = atIndex > 0 ? trimmed.slice(atIndex + 1) : undefined;

  const contract = REGISTRY.find((c) => c.capabilityId === id);
  if (!contract) {
    return { error: `unknown capability "${id}" — discover capabilities with: aisa plan discover <query>` };
  }
  if (versionText !== undefined && Number(versionText) !== contract.version) {
    return {
      error: `capability "${id}" is at version ${contract.version}; requested @${versionText} is not available`,
    };
  }
  return { contract };
}

/** 关键词检索（AND 语义），检索面覆盖 id/标题/provider/coverage。 */
export function searchCapabilities(query: string): CapabilityContract[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...REGISTRY];
  return REGISTRY.filter((c) => {
    const haystack = [
      c.capabilityId,
      c.title,
      c.binding.provider,
      ...c.dataContract.coverage,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

export function capabilityRef(contract: CapabilityContract): string {
  return `${contract.capabilityId}@${contract.version}`;
}
