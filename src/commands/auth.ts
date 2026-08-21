import chalk from "chalk";
import { setApiKey, clearApiKey, getApiKey, getKeySource, maskKey } from "../config.js";
import { success, error, info } from "../utils/display.js";
import { ENV_VAR_NAME } from "../constants.js";

export async function loginAction(options: { key?: string; browser?: boolean }): Promise<void> {
  const key = options.key || process.env[ENV_VAR_NAME];
  if (key) {
    setApiKey(key);
    success(`Authenticated: ${maskKey(key)}`);
    console.log(chalk.gray("  Get your API key at https://console.aisa.one/api-keys"));
    return;
  }
  // No key given: the browser sign-in is the front door, not an error.
  const { oauthLogin } = await import("./oauth-login.js");
  await oauthLogin({ open: options.browser });
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
