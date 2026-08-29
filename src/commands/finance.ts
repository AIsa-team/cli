import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest, cacheScope } from "../api.js";
import { error, formatJson, hint } from "../utils/display.js";
import { COINGECKO_IDS } from "../constants.js";
import { readCache, writeCache } from "../cache.js";

const coinListCacheKey = () => `coingecko/${cacheScope()}/coins-list.json`;
const COIN_LIST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const FIELD_ENDPOINTS: Record<string, string> = {
  info: "financial/company/facts",
  estimates: "financial/analyst-estimates",
  financials: "financial/financials",
  filings: "financial/filings",
  insider: "financial/insider-trades",
  institutional: "financial/institutional-ownership",
  news: "financial/news",
};

interface CompanyFacts {
  company_facts?: {
    name?: string;
    ticker?: string;
    exchange?: string;
    sector?: string;
    industry?: string;
    location?: string;
    is_active?: boolean;
  };
}

interface AnalystEstimates {
  analyst_estimates?: Array<{
    fiscal_period?: string;
    period?: string;
    earnings_per_share?: number;
    revenue?: number;
  }>;
}

interface NewsResponse {
  news?: Array<{
    title?: string;
    source?: string;
    date?: string;
    url?: string;
  }>;
}

export async function stockAction(
  symbol: string,
  options: { field?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const field = options.field || "info";
  const ticker = symbol.toUpperCase();

  // Default: show a summary of company info + estimates + news
  if (!options.field) {
    const spinner = ora(`Fetching ${ticker}...`).start();

    const [infoRes, estRes, newsRes] = await Promise.all([
      apiRequest<CompanyFacts>(key, "financial/company/facts", { query: { ticker }, domain: true }),
      apiRequest<AnalystEstimates>(key, "financial/analyst-estimates", { query: { ticker }, domain: true }),
      apiRequest<NewsResponse>(key, "financial/news", { query: { ticker, limit: "3" }, domain: true }),
    ]);

    spinner.stop();

    if (options.raw) {
      console.log(JSON.stringify({ info: infoRes.data, estimates: estRes.data, news: newsRes.data }));
      return;
    }

    // Company info
    const facts = infoRes.data?.company_facts;
    if (facts) {
      console.log(`\n  ${chalk.cyan.bold(facts.name || ticker)} ${chalk.gray(`(${facts.ticker || ticker})`)}`);
      const details = [facts.exchange, facts.sector, facts.industry].filter(Boolean).join(" · ");
      if (details) console.log(`  ${chalk.gray(details)}`);
      if (facts.location) console.log(`  ${chalk.gray(facts.location)}`);
    } else {
      console.log(`\n  ${chalk.cyan.bold(ticker)}`);
    }

    // Analyst estimates
    const estimates = estRes.data?.analyst_estimates;
    if (estimates && estimates.length > 0) {
      console.log(`\n  ${chalk.white.bold("Analyst Estimates")}`);
      for (const e of estimates.slice(0, 3)) {
        const period = e.fiscal_period?.split("T")[0] || e.period || "";
        const eps = e.earnings_per_share != null ? `EPS $${e.earnings_per_share.toFixed(2)}` : "";
        const rev = e.revenue != null ? `Rev $${(e.revenue / 1e9).toFixed(1)}B` : "";
        console.log(`    ${chalk.gray(period)}  ${eps}  ${rev}`);
      }
    }

    // Latest news
    const news = newsRes.data?.news;
    if (news && news.length > 0) {
      console.log(`\n  ${chalk.white.bold("Latest News")}`);
      for (const n of news) {
        const date = n.date ? new Date(n.date).toLocaleDateString() : "";
        console.log(`    ${chalk.gray(date)}  ${n.title}`);
      }
    }

    console.log();
    return;
  }

  // Specific field
  const endpoint = FIELD_ENDPOINTS[field];
  if (!endpoint) {
    error(`Unknown field: ${field}. Valid: ${Object.keys(FIELD_ENDPOINTS).join(", ")}`);
    return;
  }

  const spinner = ora(`Fetching ${field} for ${ticker}...`).start();

  const res = await apiRequest(key, endpoint, {
    query: { ticker },
    domain: true,
  });

  if (!res.success) {
    spinner.fail(`Failed to fetch ${field}`);
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(formatJson(res.data));
  }
}

const PERIOD_DAYS: Record<string, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

interface CoinListEntry {
  id: string;
  symbol: string;
  name: string;
}

/**
 * Resolve a user-typed symbol to a CoinGecko coin id: alias table first, then
 * the full coin list (cached, ~18k entries). Ambiguous symbols are reported
 * rather than guessed — picking one would silently price the wrong token.
 */
async function resolveCoinId(key: string, symbol: string): Promise<string> {
  const lower = symbol.toLowerCase();
  if (COINGECKO_IDS[lower]) return COINGECKO_IDS[lower];

  const cached = readCache<CoinListEntry[]>(coinListCacheKey());
  let coins = cached?.fresh ? cached.data : undefined;

  if (!coins) {
    const res = await apiRequest<CoinListEntry[]>(key, "coingecko/coins/list", { domain: true });
    if (res.success && Array.isArray(res.data)) {
      coins = res.data;
      writeCache(coinListCacheKey(), coins, COIN_LIST_TTL_MS);
    } else {
      coins = cached?.data;
    }
  }

  if (!coins) throw new Error(`Cannot resolve "${symbol}" — pass --id <coingecko-id>`);

  // An exact id match is unambiguous, so accept it before considering symbols.
  if (coins.some((c) => c.id === lower)) return lower;

  const matches = coins.filter((c) => c.symbol.toLowerCase() === lower);
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    const shown = matches.slice(0, 8).map((c) => `${c.id} (${c.name})`);
    throw new Error(
      `"${symbol}" matches ${matches.length} coins — pick one with --id:\n    ${shown.join("\n    ")}`
    );
  }
  throw new Error(`Unknown coin "${symbol}" — pass --id <coingecko-id>`);
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toPrecision(4)}`;
}

function formatBig(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

export async function cryptoAction(
  symbol: string,
  options: { period?: string; raw?: boolean; id?: string; source?: string }
): Promise<void> {
  const key = requireApiKey();

  // The financial provider's crypto endpoints return 403 for standard keys;
  // coingecko covers the same ground and is cheaper, so it is the default.
  if (options.source === "financial") {
    return cryptoViaFinancial(key, symbol, options);
  }

  const spinner = ora(`Fetching ${symbol.toUpperCase()}...`).start();

  let coinId: string;
  try {
    coinId = options.id || (await resolveCoinId(key, symbol));
  } catch (err) {
    spinner.stop();
    error((err as Error).message);
    return;
  }

  const historical = options.period && options.period !== "current";
  const endpoint = historical
    ? `coingecko/coins/${encodeURIComponent(coinId)}/market_chart`
    : "coingecko/simple/price";
  const query: Record<string, string> = historical
    ? { vs_currency: "usd", days: String(PERIOD_DAYS[options.period as string] || 30) }
    : {
        ids: coinId,
        vs_currencies: "usd",
        include_market_cap: "true",
        include_24hr_vol: "true",
        include_24hr_change: "true",
        include_last_updated_at: "true",
      };

  const res = await apiRequest<Record<string, unknown>>(key, endpoint, { query, domain: true });

  if (!res.success) {
    spinner.fail("Failed to fetch crypto price");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
    return;
  }

  if (historical) {
    const prices = (res.data as { prices?: Array<[number, number]> }).prices || [];
    if (prices.length === 0) {
      console.log(formatJson(res.data));
      return;
    }
    const first = prices[0][1];
    const last = prices[prices.length - 1][1];
    const change = ((last - first) / first) * 100;
    console.log(`\n  ${chalk.cyan.bold(coinId)} ${chalk.gray(`· ${options.period}`)}`);
    console.log(`  Now:    ${formatUsd(last)}`);
    console.log(`  Start:  ${formatUsd(first)}`);
    console.log(
      `  Change: ${change >= 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`)}`
    );
    console.log(chalk.gray(`  ${prices.length} data points`));
    console.log();
    return;
  }

  const snapshot = (res.data as Record<string, Record<string, number>>)[coinId];
  if (!snapshot) {
    console.log(formatJson(res.data));
    return;
  }

  const change = snapshot.usd_24h_change;
  console.log(`\n  ${chalk.cyan.bold(coinId)} ${chalk.gray(`(${symbol.toUpperCase()})`)}`);
  console.log(`  Price:     ${formatUsd(snapshot.usd)}`);
  if (change != null) {
    console.log(
      `  24h:       ${change >= 0 ? chalk.green(`+${change.toFixed(2)}%`) : chalk.red(`${change.toFixed(2)}%`)}`
    );
  }
  if (snapshot.usd_market_cap != null) console.log(`  Mkt cap:   ${formatBig(snapshot.usd_market_cap)}`);
  if (snapshot.usd_24h_vol != null) console.log(`  24h vol:   ${formatBig(snapshot.usd_24h_vol)}`);
  console.log();
}

/** Legacy path, kept behind --source for accounts that do have crypto access. */
async function cryptoViaFinancial(
  key: string,
  symbol: string,
  options: { period?: string; raw?: boolean }
): Promise<void> {
  const spinner = ora(`Fetching ${symbol.toUpperCase()}...`).start();

  const ticker = symbol.toUpperCase().includes("-") ? symbol.toUpperCase() : `${symbol.toUpperCase()}-USD`;
  const query: Record<string, string> = { ticker };
  let endpoint: string;

  if (!options.period || options.period === "current") {
    endpoint = "financial/crypto/prices/snapshot";
  } else {
    endpoint = "financial/crypto/prices";
    const start = new Date();
    start.setDate(start.getDate() - (PERIOD_DAYS[options.period] || 30));
    query.interval = "day";
    query.interval_multiplier = "1";
    query.start_date = start.toISOString().split("T")[0];
    query.end_date = new Date().toISOString().split("T")[0];
  }

  const res = await apiRequest(key, endpoint, { query, domain: true });

  if (!res.success) {
    spinner.fail("Failed to fetch crypto price");
    error(res.error || "Unknown error");
    if ((res.error || "").includes("403")) {
      hint("Crypto access is restricted on this provider — omit --source to use coingecko");
    }
    return;
  }

  spinner.stop();
  console.log(options.raw ? JSON.stringify(res.data) : formatJson(res.data));
}

/**
 * The screener matches sectors against GICS names, so the short forms people
 * naturally type ("Technology", "Healthcare") silently return zero results.
 */
const GICS_SECTORS = [
  "Energy",
  "Materials",
  "Industrials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Information Technology",
  "Communication Services",
  "Utilities",
  "Real Estate",
];

const SECTOR_ALIASES: Record<string, string> = {
  tech: "Information Technology",
  technology: "Information Technology",
  it: "Information Technology",
  healthcare: "Health Care",
  health: "Health Care",
  finance: "Financials",
  financial: "Financials",
  telecom: "Communication Services",
  communications: "Communication Services",
  consumer: "Consumer Discretionary",
  staples: "Consumer Staples",
  discretionary: "Consumer Discretionary",
  realestate: "Real Estate",
  utility: "Utilities",
};

function normalizeSector(input: string): string {
  const exact = GICS_SECTORS.find((s) => s.toLowerCase() === input.toLowerCase());
  if (exact) return exact;
  return SECTOR_ALIASES[input.toLowerCase().replace(/[\s_-]/g, "")] || input;
}

/** Parse a `field:operator:value` filter, e.g. `market_cap:gt:1e12`. */
function parseFilter(raw: string): { field: string; operator: string; value: unknown } {
  const parts = raw.split(":");
  if (parts.length < 3) {
    throw new Error(`Invalid filter "${raw}". Use field:operator:value, e.g. market_cap:gt:1000000000`);
  }
  const [field, operator, ...rest] = parts;
  const value = rest.join(":");
  const num = Number(value);
  return { field, operator, value: value !== "" && !Number.isNaN(num) ? num : value };
}

export async function screenerAction(options: {
  sector?: string;
  minMarketCap?: string;
  filter?: string[];
  limit?: string;
  raw?: boolean;
}): Promise<void> {
  const key = requireApiKey();

  const filters: Array<{ field: string; operator: string; value: unknown }> = [];
  if (options.sector) {
    filters.push({ field: "sector", operator: "eq", value: normalizeSector(options.sector) });
  }
  if (options.minMarketCap) {
    filters.push({ field: "market_cap", operator: "gt", value: Number(options.minMarketCap) });
  }
  for (const raw of options.filter || []) {
    filters.push(parseFilter(raw));
  }

  // The upstream rejects an empty filter set outright, so give unfiltered runs
  // a broad default rather than surfacing "Please include filters".
  if (filters.length === 0) {
    filters.push({ field: "market_cap", operator: "gt", value: 1_000_000_000 });
    hint("No filters given — defaulting to market cap > $1B");
  }

  const spinner = ora("Running stock screener...").start();

  const body: Record<string, unknown> = { filters };
  if (options.limit) body.limit = parseInt(options.limit);

  const res = await apiRequest<{ results?: unknown[] }>(
    key,
    "financial/financials/search/screener",
    // A screener run is a query with a body too large for a query string.
    { method: "POST", body, domain: true, idempotent: true }
  );

  if (!res.success) {
    spinner.fail("Screener failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
    return;
  }

  const results = res.data?.results;
  if (Array.isArray(results) && results.length === 0 && options.sector) {
    console.log("  No matches.");
    hint(`Sector must be a GICS name: ${GICS_SECTORS.join(", ")}`);
    return;
  }

  console.log(formatJson(res.data));
}
