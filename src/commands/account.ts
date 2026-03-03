import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { hint } from "../utils/display.js";

export async function balanceAction(): Promise<void> {
  requireApiKey();
  console.log(chalk.yellow("  Balance API is not yet available."));
  hint("Check your balance at https://aisa.one/dashboard");
}

export async function usageAction(_options: { limit?: string; days?: string }): Promise<void> {
  requireApiKey();
  console.log(chalk.yellow("  Usage API is not yet available."));
  hint("View usage history at https://aisa.one/dashboard");
}
