import { VERSION } from "../constants.js";
import { success, error, info, hint } from "../utils/display.js";
import { runShell, runSync, QUICK_TIMEOUT_MS } from "../utils/exec.js";
import { pickNpmChannel, npmPrefixWritable } from "./install.js";

const PACKAGE = "@aisa-one/cli";

/** The version actually on PATH — may differ from the VERSION this process
 *  was built with if another copy shadows it, so ask the binary, not the build. */
function installedVersion(): string {
  const r = runSync("aisa", ["--version"], { timeout: QUICK_TIMEOUT_MS });
  return r.status === 0 ? r.stdout.trim() : VERSION;
}

export async function updateAction(): Promise<void> {
  const before = installedVersion();
  info(`Current version: ${before}`);

  const channel = await pickNpmChannel(PACKAGE);
  if (channel.kind === "offline") {
    error("Could not reach the npm registry (official or mirror)");
    hint("check your network and try again");
    process.exitCode = 1;
    return;
  }
  const flag = channel.kind === "mirror" ? ` --registry=${channel.registry}` : "";
  const command = `npm install -g ${PACKAGE}@latest${flag}`;

  if (!npmPrefixWritable()) {
    error("npm's global prefix is not writable by this user");
    hint(`run this yourself: ${command}`);
    process.exitCode = 1;
    return;
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
