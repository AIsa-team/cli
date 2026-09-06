import chalk from "chalk";
import { setApiKey, clearApiKey, getApiKey, getKeySource, maskKey } from "../config.js";
import { success, error, info } from "../utils/display.js";
import { ENV_VAR_NAME } from "../constants.js";

export async function loginAction(options: { key?: string; browser?: boolean }): Promise<void> {
  const key = options.key || process.env[ENV_VAR_NAME];
  if (key) {
    setApiKey(key);
    success(`Authenticated: ${maskKey(key)}`);
    await proveItWorks();
    return;
  }
  // No key given: the browser sign-in is the front door, not an error.
  //
  // `--no-browser` leaves `browser` false; not passing it leaves it true,
  // and passing that on as an explicit "yes" overrode the machine's own read
  // of whether it has a browser at all — which is how a server ended up
  // waiting for a click. Only the false case is the user speaking.
  const { oauthLogin } = await import("./oauth-login.js");
  await oauthLogin(options.browser === false ? { open: false } : {});
  await proveItWorks();
}

/**
 * Use the key we just stored, and show what came back.
 *
 * "Signed in — key stored" says a file was written. It does not say the key
 * works, and those are different claims: a pasted key can be the wrong one, a
 * minted one can belong to an account with no credit. Ending on a balance
 * turns the question "did that work?" into something already answered on
 * screen, which is what someone finishing a sign-in actually wants to know.
 *
 * Failure here is not a failed sign-in — the key is stored either way — so it
 * says what it could not do and points at the command to retry with.
 */
async function proveItWorks(): Promise<void> {
  try {
    const { balanceAction } = await import("./account.js");
    await balanceAction();
  } catch (e) {
    info(`Stored, but could not read your balance: ${(e as Error).message}`);
    console.log(chalk.gray("  Try: aisa balance"));
  }
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
