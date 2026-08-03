import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { formatJson, hint } from "../utils/display.js";
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
  const key = requireApiKey();
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
  if (balance.api_key.unlimited) {
    console.log("  API key limit:       Unlimited");
  } else {
    console.log(`  API key limit:       ${formatMicrosUSD(balance.api_key.remaining_micros_usd)} remaining`);
  }
}

export async function usageAction(_options: { limit?: string; days?: string }): Promise<void> {
  requireApiKey();
  console.log(chalk.yellow("  Usage API is not yet available."));
  hint("View usage history at https://aisa.one/dashboard");
}
