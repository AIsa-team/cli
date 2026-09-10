import chalk from "chalk";
import { replaceTokens, revokeAndClearTokens, getAccessToken, getKeySource, maskKey, AUTH_SETUP_GUIDANCE } from "../config.js";
import { success, error, info } from "../utils/display.js";
import { CONSOLE_URL, ENV_VAR_NAME } from "../constants.js";

export async function loginAction(options: { key?: string; browser?: boolean }): Promise<void> {
  const key = options.key || process.env[ENV_VAR_NAME];
  if (key) {
    await replaceTokens(key);
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

/** Show the balance after storing credentials; a balance failure does not undo login. */
async function proveItWorks(): Promise<void> {
  try {
    const { balanceAction } = await import("./account.js");
    await balanceAction();
  } catch (e) {
    info(`Stored, but could not read your balance: ${(e as Error).message}`);
    console.log(chalk.gray("  Try: aisa balance"));
  }
  // Last line, and an address rather than a command: everything above is
  // this machine, and the account behind it lives somewhere the terminal
  // cannot show. Written out so it can be remembered, not just clicked.
  console.log(chalk.gray(`  Account, usage and top-ups — ${chalk.cyan(CONSOLE_URL)}`));
}

export async function logoutAction(): Promise<void> {
  const revoked = await revokeAndClearTokens();
  success(revoked ? "Logged out. OAuth refresh token revoked and stored tokens removed." : "Logged out. Stored tokens removed.");
  if (revoked) info("Already-issued access tokens remain valid until they expire.");
  if (process.env[ENV_VAR_NAME]) info(`${ENV_VAR_NAME} is still set. Unset it to stop using that API key.`);
}

export async function whoamiAction(): Promise<void> {
  const key = await getAccessToken();
  const source = getKeySource();

  if (!key) {
    info("Not authenticated.");
    console.log(chalk.gray(`  ${AUTH_SETUP_GUIDANCE}`));
    return;
  }

  console.log(`  Token:  ${maskKey(key)}`);
  console.log(`  Source: ${source === "env" ? `${ENV_VAR_NAME} env var` : "~/.aisa/tokens.json"}`);
}
