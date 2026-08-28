import { execFile, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { promisify } from "node:util";

/**
 * Every child process this CLI starts goes through here.
 *
 * The reason is one bug we shipped twice: Node's `execFile` and `spawnSync`
 * default to a 1 MB output buffer, and a global npm install prints more than
 * that. On overflow Node kills the child and reports an error — after the
 * package is already on disk — so a successful install read as a failure and
 * the run went into a pointless retry (or hung waiting on it). Anything that
 * shells out to a package manager, a vendor installer or an agent's own CLI
 * can exceed 1 MB, so the buffer is raised in one place rather than
 * remembered at 21 call sites.
 *
 * Timeouts live here too: a child with no timeout is a run that can hang for
 * ever. Callers that legitimately need longer pass their own.
 */

/** Beyond anything an installer or a client CLI prints. */
export const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
/** Enough for an agent install over a slow link; short of forever. */
export const DEFAULT_TIMEOUT_MS = 300_000;
/** For a quick question to a local binary (`--version`, `mcp list`). */
export const QUICK_TIMEOUT_MS = 20_000;

const execFileRaw = promisify(execFile);

export interface RunOptions {
  timeout?: number;
  /** Passed through when a command must see specific variables. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** Run a binary with arguments. Rejects on a non-zero exit, like execFile. */
export function run(
  file: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFileRaw(file, [...args], {
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: options.env,
    cwd: options.cwd,
    encoding: "utf8",
  }) as Promise<{ stdout: string; stderr: string }>;
}

/** Run a shell command line (pipelines, `a; b`). Never rejects: the caller
 *  decides what a non-zero exit means, which is almost never "give up". */
export async function runShell(
  command: string,
  options: RunOptions = {}
): Promise<{ ok: boolean; stdout: string; stderr: string; detail: string }> {
  try {
    const { stdout, stderr } = await run("/bin/sh", ["-c", command], options);
    return { ok: true, stdout, stderr, detail: "" };
  } catch (e) {
    const err = e as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      detail: err.message.split("\n")[0],
    };
  }
}

/** Ask a local binary something and wait for the answer. */
export function runSync(
  file: string,
  args: readonly string[],
  options: RunOptions = {}
): SpawnSyncReturns<string> {
  return spawnSync(file, [...args], {
    timeout: options.timeout ?? QUICK_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: options.env,
    cwd: options.cwd,
    encoding: "utf8",
  });
}
