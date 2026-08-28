import { run } from "../utils/exec.js";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { formatJson, hint, info, error } from "../utils/display.js";
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
  // Say it here rather than at the failed call: a balance read is exactly when
  // someone can act on it.
  if (Number(balance.account_balance_micros_usd) <= 0) {
    hint("Out of credit — run 'aisa topup' to add some");
  }
}

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
    url = `${CONSOLE_BILLING_URL}?amount=${value}`;
    info(`Opening the billing page to add ${formatMicrosUSD(BigInt(Math.round(value * 1_000_000)))}`);
  } else {
    info("Opening the billing page — choose an amount there");
  }
  console.log(`  ${chalk.cyan(url)}`);

  if (options.open === false) return;
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  void run(cmd, [url], { timeout: 30_000 }).catch(() => {});
  hint("Credit lands in your account as soon as the payment completes");
}

export async function usageAction(_options: { limit?: string; days?: string }): Promise<void> {
  requireApiKey();
  // The gateway does not serve /v1/credits/usage yet — it 404s in production
  // even though /v1/credits/balance on the same route group works.
  console.log(chalk.yellow("  Usage API is not yet available on the gateway."));
  hint("View usage history at https://console.aisa.one/logs");
}
