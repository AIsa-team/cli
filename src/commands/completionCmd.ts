import type { Command } from "commander";
import { basename } from "node:path";
import { complete, completionScript, isShell, type Shell } from "../completion.js";
import { error, hint } from "../utils/display.js";

/** Guess the user's shell from $SHELL so `aisa completion` can work bare. */
function detectShell(): Shell | undefined {
  const name = basename(process.env.SHELL || "");
  return isShell(name) ? name : undefined;
}

export function completionAction(shell: string | undefined): void {
  const target = shell || detectShell();

  if (!target) {
    error("Could not detect your shell.");
    hint("Run: aisa completion <bash|zsh|fish>");
    process.exit(1);
  }
  if (!isShell(target)) {
    error(`Unsupported shell: ${target}. Supported: bash, zsh, fish`);
    process.exit(1);
  }

  console.log(completionScript(target));
}

/**
 * Hidden helper the shell scripts call on every Tab press. Prints one candidate
 * per line as "value<TAB>description"; the shell does the prefix filtering.
 */
export function completeAction(program: Command, words: string[]): void {
  try {
    for (const candidate of complete(program, words)) {
      console.log(
        candidate.description
          ? `${candidate.value}\t${candidate.description.replace(/\s+/g, " ")}`
          : candidate.value
      );
    }
  } catch {
    // Never let a completion failure print noise into the user's prompt.
  }
}
