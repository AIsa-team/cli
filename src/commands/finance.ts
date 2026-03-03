import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson } from "../utils/display.js";

const FIELD_ENDPOINTS: Record<string, string> = {
  price: "financial/prices",
  earnings: "financial/earnings/press-releases",
  financials: "financial/financials",
  filings: "financial/filings",
  insider: "financial/insider-trades",
  institutional: "financial/institutional-ownership",
  metrics: "financial/financial-metrics/snapshot",
  news: "financial/news",
};

export async function stockAction(
  symbol: string,
  options: { field?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const field = options.field || "price";
  const endpoint = FIELD_ENDPOINTS[field];

  if (!endpoint) {
    error(`Unknown field: ${field}. Valid: ${Object.keys(FIELD_ENDPOINTS).join(", ")}`);
    return;
  }

  const spinner = ora(`Fetching ${field} for ${symbol.toUpperCase()}...`).start();

  const query: Record<string, string> = { ticker: symbol.toUpperCase() };

  // Price endpoint needs additional params for sensible defaults
  if (field === "price") {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    query.interval = "day";
    query.interval_multiplier = "1";
    query.start_date = start.toISOString().split("T")[0];
    query.end_date = end.toISOString().split("T")[0];
    query.limit = "30";
  }

  const res = await apiRequest(key, endpoint, {
    query,
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
