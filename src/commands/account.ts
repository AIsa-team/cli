import { run } from "../utils/exec.js";
import chalk from "chalk";
import { requireAccessToken } from "../config.js";
import { apiRequest } from "../api.js";
import { usageError } from "../cli-error.js";
import { formatJson, hint, info, error, table } from "../utils/display.js";
import { CONSOLE_BILLING_URL } from "../constants.js";
import type { BalanceResponse } from "../types.js";

export function formatMicrosUSD(micros: number | string | bigint): string {
  const value = typeof micros === "bigint" ? micros : BigInt(micros);
  const negative = value < 0n;
  let absolute = negative ? -value : value;
  let cents = (absolute % 1_000_000n + 5_000n) / 10_000n;
  let dollars = absolute / 1_000_000n;
  if (cents === 100n) {
    dollars += 1n;
    cents = 0n;
  }
  return `${negative ? "-" : ""}$${dollars.toString()}.${cents.toString().padStart(2, "0")}`;
}

export async function balanceAction(options: { json?: boolean } = {}): Promise<void> {
  const key = await requireAccessToken();
  const res = await apiRequest<BalanceResponse>(key, "credits/balance");

  if (!res.success || !res.data) {
    throw new Error(res.error || "Failed to fetch balance");
  }

  if (options.json) {
    console.log(formatJson(res.data));
    return;
  }

  const balance = res.data;
  console.log(`  Balance:             ${formatMicrosUSD(balance.account_balance_micros_usd)} ${balance.currency}`);
  console.log(`  Available with key:  ${formatMicrosUSD(balance.available_balance_micros_usd)} ${balance.currency}`);
  console.log(`  GTM balance:         ${formatMicrosUSD(balance.go_to_market_balance_micros_usd)} ${balance.currency}`);
  if (balance.api_key.unlimited) {
    console.log("  API key limit:       Unlimited");
  } else {
    console.log(`  API key limit:       ${formatMicrosUSD(balance.api_key.remaining_micros_usd)} remaining`);
  }
  // Say it here rather than at the failed call: a balance read is exactly when
  // someone can act on it.
  if (Number(balance.account_balance_micros_usd) <= 0) {
    hint("Out of credit — run 'aisa topup' to add some");
  }
}

/**
 * Minimum top-up in US dollars.
 *
 * Source of truth: the console constant BILLING_MIN_TOPUP_MICROS_USD
 * (production is $10). `/api/billing/config` needs a console session, which
 * this CLI's OAuth token cannot obtain, so the floor is fixed here instead
 * of being read at runtime.
 */
export const MIN_TOPUP_USD = 10;

/**
 * `aisa topup [amount]` — open the console's billing page to add credit.
 *
 * Payment ends in a browser no matter what: card details must reach Stripe's
 * hosted page, not us (PCI), and a bank's 3-D Secure step has nowhere else to
 * run. So this command's job is to get the user to the right page, not to
 * take a payment.
 *
 * With an amount it deep-links `?amount=`, which the billing page can prefill;
 * without one the page is where the choice belongs. A future version can mint
 * a Stripe checkout URL directly (backend already returns one from
 * POST /api/billing/topups) and skip a hop — that needs the console API to
 * accept the CLI's OAuth token, which it does not yet.
 */
export function topupAction(amount: string | undefined, options: { open?: boolean } = {}): void {
  let url = CONSOLE_BILLING_URL;
  if (amount !== undefined) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      error(`Invalid amount: ${amount}`);
      hint("Pass a positive number of US dollars, e.g. 'aisa topup 20'");
      process.exitCode = 1;
      return;
    }
    if (value < MIN_TOPUP_USD) {
      error(`Minimum top-up is $${MIN_TOPUP_USD} (got ${amount}).`);
      hint(`The minimum top-up is $${MIN_TOPUP_USD}, e.g. 'aisa topup ${MIN_TOPUP_USD}'.`);
      process.exitCode = 1;
      return;
    }
    url = `${CONSOLE_BILLING_URL}?amount=${value}`;
    info(`Opening the billing page to add ${formatMicrosUSD(BigInt(Math.round(value * 1_000_000)))}`);
  } else {
    info("Opening the billing page — choose an amount there");
    hint(`The minimum top-up is $${MIN_TOPUP_USD}`);
  }
  console.log(`  ${chalk.cyan(url)}`);

  if (options.open === false) return;
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  void run(cmd, [url], { timeout: 30_000 }).catch(() => {});
  hint("Credit lands in your account as soon as the payment completes");
}

/** Gateway caps GET /v1/usage at 31 days; buckets are fixed at one day. */
export const USAGE_MAX_WINDOW_DAYS = 31;
export const USAGE_DEFAULT_DAYS = 7;
const USAGE_DAY_SECONDS = 86_400;
const USAGE_WINDOW_ERROR =
  "The usage window is at most 31 days. Pass --days as an integer from 1 to 31.";

export interface UsageMetrics {
  requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  usage_value_micros_usd: number;
  charged_micros_usd: number;
}

export interface UsageBucket extends UsageMetrics {
  start_time: number;
  end_time: number;
}

export interface UsageResponse {
  scope: string;
  currency: string;
  start_time: number;
  end_time: number;
  bucket_width: string;
  totals: UsageMetrics;
  buckets: UsageBucket[];
}

export interface UsageQuery {
  start_time: string;
  /** Sent alongside start_time so the window is exactly --days wide even if
   *  the gateway's clock runs ahead of ours; a server-filled end_time could
   *  push a 31-day request past the gateway's own cap. */
  end_time: string;
  scope: "key" | "account";
}

export interface ParsedUsageOptions {
  query: UsageQuery;
  /** Omitted means the table shows every daily bucket in the window. */
  limit?: number;
}

export interface UsageActionOptions {
  days?: string;
  scope?: string;
  limit?: string;
  json?: boolean;
}

/**
 * `aisa usage` reads GET /v1/usage.
 *
 * start_time and end_time are both sent as a coherent pair so the window is
 * exactly --days wide even when the gateway's clock runs ahead of ours. The
 * window cannot exceed 31 days.
 * scope=key is this credential; scope=account sums the whole account, which
 * an OAuth token is allowed to request. --limit trims the table to the latest
 * N days. --json prints the gateway body unchanged.
 */
export function parseUsageOptions(
  options: { days?: string; scope?: string; limit?: string },
  nowSeconds: number,
): ParsedUsageOptions {
  const days = parseUsageDays(options.days);
  const scope = parseUsageScope(options.scope);
  const limit = parseUsageLimit(options.limit);
  if (!Number.isFinite(nowSeconds)) {
    throw usageError("Usage start_time must be a positive Unix timestamp in seconds.");
  }
  const end = Math.floor(nowSeconds);
  const start = end - days * USAGE_DAY_SECONDS;
  if (start <= 0) {
    throw usageError("Usage start_time must be a positive Unix timestamp in seconds.");
  }
  return limit === undefined
    ? { query: { start_time: String(start), end_time: String(end), scope } }
    : { query: { start_time: String(start), end_time: String(end), scope }, limit };
}

function parseUsageDays(raw: string | undefined): number {
  const text = raw === undefined || raw.trim() === "" ? String(USAGE_DEFAULT_DAYS) : raw.trim();
  if (!/^\d+$/.test(text)) throw usageError(USAGE_WINDOW_ERROR);
  const days = Number(text);
  if (!Number.isSafeInteger(days) || days < 1 || days > USAGE_MAX_WINDOW_DAYS) {
    throw usageError(USAGE_WINDOW_ERROR);
  }
  return days;
}

function parseUsageScope(raw: string | undefined): UsageQuery["scope"] {
  const text = raw === undefined || raw.trim() === "" ? "key" : raw.trim();
  if (text !== "key" && text !== "account") {
    throw usageError('Pass --scope as "key" or "account".');
  }
  return text;
}

function parseUsageLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) throw usageError("--limit must be a positive integer.");
  const limit = Number(raw.trim());
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw usageError("--limit must be a positive integer.");
  }
  return limit;
}

/** UTC calendar day (YYYY-MM-DD) for a bucket's start_time. The gateway
 *  buckets at UTC day boundaries, so a local-timezone label would show the
 *  previous calendar day for every UTC-midnight bucket in UTC-negative zones. */
export function formatUsageDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

/** Chronological order, then the latest `limit` buckets. A missing limit keeps
 *  the whole window. */
export function selectRecentBuckets(buckets: readonly UsageBucket[], limit?: number): UsageBucket[] {
  const sorted = [...buckets].sort((a, b) => Number(a.start_time) - Number(b.start_time));
  if (limit === undefined) return sorted;
  return sorted.slice(-limit);
}

export function renderUsageReport(buckets: readonly UsageBucket[]): string {
  if (buckets.length === 0) return "  No usage in this window.";
  const headers = ["Date", "Requests", "Failed", "Input tokens", "Output tokens", "Charged"];
  const rows = buckets.map((bucket) => [
    formatUsageDate(Number(bucket.start_time)),
    formatCount(bucket.requests),
    formatCount(bucket.failed_requests),
    formatCount(bucket.input_tokens),
    formatCount(bucket.output_tokens),
    formatMicrosUSD(asMicros(bucket.charged_micros_usd)),
  ]);
  rows.push([
    "Total",
    formatCount(sumCount(buckets, "requests")),
    formatCount(sumCount(buckets, "failed_requests")),
    formatCount(sumCount(buckets, "input_tokens")),
    formatCount(sumCount(buckets, "output_tokens")),
    formatMicrosUSD(sumMicros(buckets)),
  ]);
  return table(headers, rows);
}

function formatCount(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.trunc(n));
}

function sumCount(
  buckets: readonly UsageBucket[],
  key: "requests" | "failed_requests" | "input_tokens" | "output_tokens",
): number {
  return buckets.reduce((sum, bucket) => {
    const n = Number(bucket[key]);
    return sum + (Number.isFinite(n) ? Math.trunc(n) : 0);
  }, 0);
}

function asMicros(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  return 0n;
}

function sumMicros(buckets: readonly UsageBucket[]): bigint {
  return buckets.reduce((sum, bucket) => sum + asMicros(bucket.charged_micros_usd), 0n);
}

export async function usageAction(options: UsageActionOptions = {}): Promise<void> {
  const parsed = parseUsageOptions(options, Math.floor(Date.now() / 1000));
  const token = await requireAccessToken();
  const res = await apiRequest<UsageResponse>(token, "usage", {
    query: {
      start_time: parsed.query.start_time,
      end_time: parsed.query.end_time,
      scope: parsed.query.scope,
    },
  });
  if (!res.success || !res.data) {
    throw new Error(res.error || "Failed to fetch usage");
  }
  if (options.json) {
    console.log(formatJson(res.data));
    return;
  }
  const buckets = Array.isArray(res.data.buckets) ? res.data.buckets : [];
  console.log(renderUsageReport(selectRecentBuckets(buckets, parsed.limit)));
}
