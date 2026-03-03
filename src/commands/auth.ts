import chalk from "chalk";
import { setApiKey, clearApiKey, getApiKey, getKeySource, maskKey } from "../config.js";
import { success, error, info } from "../utils/display.js";
import { ENV_VAR_NAME } from "../constants.js";

export function loginAction(options: { key?: string }): void {
  const key = options.key || process.env[ENV_VAR_NAME];
  if (!key) {
    error(`Provide a key with --key or set ${ENV_VAR_NAME}`);
    process.exit(1);
  }

  setApiKey(key);
  success(`Authenticated: ${maskKey(key)}`);
  console.log(chalk.gray("  Get your API key at https://aisa.one/dashboard"));
}

export function logoutAction(): void {
  clearApiKey();
  success("Logged out. API key removed.");
}

export function whoamiAction(): void {
  const key = getApiKey();
  const source = getKeySource();

  if (!key) {
    info("Not authenticated.");
    console.log(chalk.gray(`  Run "aisa login --key <key>" or set ${ENV_VAR_NAME}`));
    return;
  }

  console.log(`  Key:    ${maskKey(key)}`);
  console.log(`  Source: ${source === "env" ? `${ENV_VAR_NAME} env var` : "stored config"}`);
}
