import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { hint } from "../utils/display.js";

const COMING_SOON = chalk.yellow("  API catalog is not yet available.");
const BROWSE_HINT = "Browse available APIs at https://docs.aisa.one/reference";

export async function apiListAction(_options: { category?: string }): Promise<void> {
  requireApiKey();
  console.log(COMING_SOON);
  hint(BROWSE_HINT);
  hint("Use 'aisa run <slug> <path>' to call APIs directly");
}

export async function apiSearchAction(_query: string, _options: { limit?: string }): Promise<void> {
  requireApiKey();
  console.log(COMING_SOON);
  hint(BROWSE_HINT);
}

export async function apiShowAction(_slug: string, _path?: string): Promise<void> {
  requireApiKey();
  console.log(COMING_SOON);
  hint(BROWSE_HINT);
}

export async function apiCodeAction(
  _slug: string,
  _path: string,
  _options: { lang?: string }
): Promise<void> {
  requireApiKey();
  console.log(COMING_SOON);
  hint(BROWSE_HINT);
}
