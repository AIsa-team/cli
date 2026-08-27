import chalk from "chalk";
import { formatJson, hint } from "../utils/display.js";

const TRAFFIC_ENGAGEMENT_DOCS_URL =
  "https://aisa.one/docs/api-reference/similarweb/get_similarweb-website-traffic-engagement";
const TRAFFIC_ENGAGEMENT_PRODUCT_URL = "https://aisa.one/api/similarweb";
const VERIFIED_AT = "2026-08-27";

type PlanStatus = "ready" | "over_budget";

export interface SimilarwebTrafficPlanInput {
  domain: string;
  country?: string;
  start?: string;
  end?: string;
  granularity?: string;
  metrics?: string;
  mainDomainOnly?: boolean;
  maxCredits?: string;
}

export interface SimilarwebTrafficPlan {
  status: PlanStatus;
  summary: {
    capability: "similarweb.traffic_engagement";
    support: "supported";
    estimate_credits: number;
    max_credits: number;
    budget_credits?: number;
  };
  evidence: {
    endpoint: "/apis/v1/similarweb/website/traffic-engagement";
    method: "GET";
    pricing_formula: "1 credit × metrics × countries × monthly time buckets";
    source_url: string;
    product_url: string;
    verified_at: string;
  };
  scope: {
    domain: string;
    country: string;
    start_date: string;
    end_date: string;
    granularity: "monthly";
    metrics: string[];
    main_domain_only: boolean;
    time_buckets: number;
  };
  limits: string[];
  missing: string[];
  next_actions: string[];
}

function fail(message: string): never {
  throw new Error(message);
}

function parseMonth(value: string | undefined, label: string): { year: number; month: number; value: string } {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return fail(`${label} must be YYYY-MM, for example 2026-07`);
  }
  const [year, month] = value.split("-").map(Number);
  return { year, month, value };
}

function parseMetrics(value: string | undefined): string[] {
  if (!value) return fail("--metrics is required, for example visits,average_visit_duration");
  const metrics = value
    .split(",")
    .map((metric) => metric.trim())
    .filter(Boolean);
  if (metrics.length === 0) return fail("--metrics must contain at least one metric");
  if (metrics.some((metric) => !/^[a-z][a-z0-9_]*$/i.test(metric))) {
    return fail("--metrics must be comma-separated metric names, for example visits,average_visit_duration");
  }
  return [...new Set(metrics)];
}

function parseBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    return fail("--max-credits must be a positive whole number");
  }
  return Number(value);
}

function normalizeCountry(value: string | undefined): string {
  const country = (value || "world").trim().toLowerCase();
  if (!/^[a-z]{2,10}$/.test(country)) {
    return fail("--country must be a country code such as us, or world");
  }
  if (country === "ww" || country === "global") return "world";
  return country;
}

/**
 * Build a non-executing, credit-only preview for the public Similarweb
 * Traffic & Engagement API. It deliberately does not derive USD: the public
 * contract provides a credit formula but no account-specific USD rate.
 */
export function buildSimilarwebTrafficPlan(input: SimilarwebTrafficPlanInput): SimilarwebTrafficPlan {
  const domain = input.domain.trim().toLowerCase();
  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) {
    return fail("domain must be a hostname such as openai.com (without a URL path)");
  }

  if ((input.granularity || "monthly") !== "monthly") {
    return fail("P0 supports --granularity monthly only; weekly and daily need an independently verified bucket rule");
  }

  const start = parseMonth(input.start, "--start");
  const end = parseMonth(input.end, "--end");
  const startIndex = start.year * 12 + start.month;
  const endIndex = end.year * 12 + end.month;
  if (endIndex < startIndex) return fail("--end must be the same month as or later than --start");

  const metrics = parseMetrics(input.metrics);
  const timeBuckets = endIndex - startIndex + 1;
  const credits = metrics.length * timeBuckets; // this P0 command takes one country per Plan.
  const budget = parseBudget(input.maxCredits);
  const status: PlanStatus = budget !== undefined && credits > budget ? "over_budget" : "ready";

  return {
    status,
    summary: {
      capability: "similarweb.traffic_engagement",
      support: "supported",
      estimate_credits: credits,
      max_credits: credits,
      ...(budget !== undefined ? { budget_credits: budget } : {}),
    },
    evidence: {
      endpoint: "/apis/v1/similarweb/website/traffic-engagement",
      method: "GET",
      pricing_formula: "1 credit × metrics × countries × monthly time buckets",
      source_url: TRAFFIC_ENGAGEMENT_DOCS_URL,
      product_url: TRAFFIC_ENGAGEMENT_PRODUCT_URL,
      verified_at: VERIFIED_AT,
    },
    scope: {
      domain,
      country: normalizeCountry(input.country),
      start_date: start.value,
      end_date: end.value,
      granularity: "monthly",
      metrics,
      main_domain_only: input.mainDomainOnly ?? true,
      time_buckets: timeBuckets,
    },
    limits: [
      "Credit estimate is exact for this bounded monthly scope: 1 country × metrics × inclusive months.",
      "Charged only on a successful provider response, per the public product page.",
      "USD is intentionally unavailable: no public account-specific credit-to-USD quote exists.",
      "This is a non-executing preview; it does not reserve credits or enforce the budget at execution.",
    ],
    missing: [
      "A server-owned quote/reservation is required before this can enforce a credit or USD ceiling during execution.",
      "Weekly, daily, and multi-country scopes are outside this P0 command until their bucket rules are independently verified.",
    ],
    next_actions:
      status === "over_budget"
        ? ["Reduce metrics or date range, or raise --max-credits, then create a new preview."]
        : [
            "Review the frozen scope and maximum credits with the requester.",
            "Execute only after a server-owned quote/reservation is available; do not treat this preview as a spend lock.",
          ],
  };
}

export async function planSimilarwebTrafficAction(
  domain: string,
  options: Omit<SimilarwebTrafficPlanInput, "domain"> & { json?: boolean } = {}
): Promise<void> {
  const plan = buildSimilarwebTrafficPlan({ domain, ...options });

  if (options.json) {
    console.log(formatJson(plan));
  } else {
    console.log(`\n  ${chalk.cyan.bold("Similarweb Traffic & Engagement plan")}`);
    console.log(`  ${plan.status === "ready" ? chalk.green("READY") : chalk.yellow("OVER BUDGET")}`);
    console.log(`\n  Summary`);
    console.log(`  Capability: ${plan.summary.capability} (${plan.summary.support})`);
    console.log(`  Credits:    ${plan.summary.estimate_credits} estimated · ${plan.summary.max_credits} maximum`);
    if (plan.summary.budget_credits !== undefined) console.log(`  Budget:     ${plan.summary.budget_credits} credits`);
    console.log(`\n  Scope`);
    console.log(`  ${plan.scope.domain} · ${plan.scope.country} · ${plan.scope.start_date} → ${plan.scope.end_date} · monthly`);
    console.log(`  Metrics: ${plan.scope.metrics.join(", ")} (${plan.scope.metrics.length}) · Time buckets: ${plan.scope.time_buckets}`);
    console.log(`\n  Evidence`);
    console.log(`  ${plan.evidence.pricing_formula}`);
    console.log(`  ${plan.evidence.source_url} (verified ${plan.evidence.verified_at})`);
    console.log(`\n  Limits`);
    plan.limits.forEach((limit) => console.log(`  - ${limit}`));
    console.log(`\n  Missing`);
    plan.missing.forEach((item) => console.log(`  - ${item}`));
    console.log(`\n  Next actions`);
    plan.next_actions.forEach((action, index) => console.log(`  ${index + 1}. ${action}`));
  }

  if (plan.status === "over_budget") process.exitCode = 2;
  hint("Use --json for the structured plan manifest.");
  hint("Multi-capability plans: aisa plan create --budget-credits <n>");
}
