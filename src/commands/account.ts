import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, table } from "../utils/display.js";
import type { BalanceResponse, UsageRecord } from "../types.js";

export async function balanceAction(): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching balance...").start();

  const res = await apiRequest<BalanceResponse>(key, "credits/balance");

  if (!res.success || !res.data) {
    spinner.fail("Failed to fetch balance");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  console.log(`  Balance: ${chalk.green("$" + res.data.balance.toFixed(2))} ${res.data.currency}`);
  console.log(chalk.gray("  Add credits at https://aisa.one/dashboard/wallet"));
}

export async function usageAction(options: { limit?: string; days?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching usage...").start();

  const query: Record<string, string> = {};
  if (options.limit) query.limit = options.limit;
  if (options.days) query.days = options.days;

  const res = await apiRequest<{ records: UsageRecord[]; total: number }>(
    key,
    "credits/usage",
    { query }
  );

  if (!res.success || !res.data) {
    spinner.fail("Failed to fetch usage");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const { records } = res.data;

  if (records.length === 0) {
    console.log("  No usage records found.");
    return;
  }

  const rows = records.map((r) => [
    new Date(r.timestamp).toLocaleDateString(),
    r.api,
    r.endpoint,
    `$${r.cost.toFixed(4)}`,
    r.status,
  ]);

  console.log(table(["Date", "API", "Endpoint", "Cost", "Status"], rows));
}
