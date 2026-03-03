import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson } from "../utils/display.js";

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

export async function cryptoAction(
  symbol: string,
  options: { period?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Fetching ${symbol.toUpperCase()}...`).start();

  // Format ticker: BTC → BTC-USD
  const ticker = symbol.toUpperCase().includes("-") ? symbol.toUpperCase() : `${symbol.toUpperCase()}-USD`;

  let endpoint: string;
  const query: Record<string, string> = { ticker };

  if (!options.period || options.period === "current") {
    endpoint = "financial/crypto/prices/snapshot";
  } else {
    endpoint = "financial/crypto/prices";
    const end = new Date();
    const start = new Date();
    const periodMap: Record<string, number> = { "1d": 1, "7d": 7, "30d": 30, "1y": 365 };
    start.setDate(start.getDate() - (periodMap[options.period] || 30));
    query.interval = "day";
    query.interval_multiplier = "1";
    query.start_date = start.toISOString().split("T")[0];
    query.end_date = end.toISOString().split("T")[0];
  }

  const res = await apiRequest(key, endpoint, { query, domain: true });

  if (!res.success) {
    spinner.fail("Failed to fetch crypto price");
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

export async function screenerAction(options: {
  sector?: string;
  limit?: string;
  raw?: boolean;
}): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Running stock screener...").start();

  const body: Record<string, unknown> = {
    filters: [],
  };
  if (options.sector) {
    (body.filters as Array<unknown>).push({
      field: "sector",
      operator: "eq",
      value: options.sector,
    });
  }
  if (options.limit) body.limit = parseInt(options.limit);

  const res = await apiRequest(key, "financial/financials/search", {
    method: "POST",
    body,
    domain: true,
  });

  if (!res.success) {
    spinner.fail("Screener failed");
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
