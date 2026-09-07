import { VERSION } from "../constants.js";
import { success, error, info, hint } from "../utils/display.js";
import { runShell, runSync, QUICK_TIMEOUT_MS } from "../utils/exec.js";
import { pickNpmChannel, npmPrefixWritable } from "./install.js";
import { detectInstall } from "../utils/install-method.js";
import { checkForUpdate } from "../utils/update-check.js";

const PACKAGE = "@aisa-one/cli";

/** The version actually on PATH — may differ from the VERSION this process
 *  was built with if another copy shadows it, so ask the binary, not the build. */
function installedVersion(): string {
  const r = runSync("aisa", ["--version"], { timeout: QUICK_TIMEOUT_MS });
  return r.status === 0 ? r.stdout.trim() : VERSION;
}

/**
 * Update this copy of the CLI, whichever way it was installed.
 *
 * No confirmation prompt. Typing `aisa update` is the intent — asking "are
 * you sure" after it is a speed bump, not a safeguard. What does get asked is
 * the question the user cannot answer from here: when the install cannot be
 * changed by this process (no write access, or a package manager whose global
 * install this process should not guess at), the command to run is printed
 * rather than attempted.
 */
export async function updateAction(): Promise<void> {
  const before = installedVersion();
  const install = detectInstall();

  // npx resolves the published version on every invocation, so there is
  // nothing here to update — and installing a global would leave the user
  // with a second copy they did not ask for and did not know about.
  if (install.kind === "npx") {
    info(`Current version: ${before}`);
    success("Nothing to update — npx fetches the published version every time");
    hint(`for a copy that stays put: npm install -g ${PACKAGE}`);
    return;
  }

  // A checkout run from its own dist. Updating it means pulling, and this
  // process has no business guessing at someone's working tree.
  if (install.kind === "source") {
    info(`Current version: ${before}`);
    error("This is a working copy, not an installed package");
    hint(`running from ${install.path} — update it with git`);
    process.exitCode = 1;
    return;
  }

  const latest = await checkForUpdate({ current: before });
  info(`Current version: ${before}${latest ? ` — ${latest} is available` : ""}`);

  if (!install.command) {
    error("Could not tell how this copy was installed");
    hint(`running from ${install.path}`);
    hint(`if you used npm: npm install -g ${PACKAGE}@latest`);
    process.exitCode = 1;
    return;
  }

  // The registry probe and the writability check are npm's business; the
  // other managers have their own resolution and their own global roots, and
  // a guess about either is worse than letting the manager speak for itself.
  let command = install.command;
  if (install.kind === "npm") {
    const channel = await pickNpmChannel(PACKAGE);
    if (channel.kind === "offline") {
      error("Could not reach the npm registry (official or mirror)");
      hint("check your network and try again");
      process.exitCode = 1;
      return;
    }
    if (channel.kind === "mirror") command += ` --registry=${channel.registry}`;
    if (!npmPrefixWritable()) {
      error("npm's global prefix is not writable by this user");
      hint(`run this yourself: ${command}`);
      process.exitCode = 1;
      return;
    }
  }

  info(command);
  const result = await runShell(command);
  if (!result.ok) {
    error("Update failed");
    if (result.detail) hint(result.detail);
    hint(`you can also run it yourself: ${command}`);
    process.exitCode = 1;
    return;
  }

  const after = installedVersion();
  if (after === before) {
    success(`Already on the latest version (${after})`);
  } else {
    success(`Updated ${before} → ${after}`);
  }
}
