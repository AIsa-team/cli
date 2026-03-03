import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson } from "../utils/display.js";

const FIELD_ENDPOINTS: Record<string, string> = {
  price: "stock/price",
  earnings: "analyst-estimates",
  financials: "financial-statements",
  filings: "filings",
  insider: "insider-trades",
  institutional: "institutional-ownership",
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

  const res = await apiRequest(key, endpoint, {
    query: { symbol: symbol.toUpperCase() },
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

  const query: Record<string, string> = { symbol: symbol.toUpperCase() };
  if (options.period) query.period = options.period;

  const endpoint = options.period && options.period !== "current"
    ? "crypto/price"
    : "crypto/price/snapshot";

  const res = await apiRequest(key, endpoint, { query });

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

  const body: Record<string, unknown> = {};
  if (options.sector) body.sector = options.sector;
  if (options.limit) body.limit = parseInt(options.limit);

  const res = await apiRequest(key, "search/financials", {
    method: "POST",
    body,
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
