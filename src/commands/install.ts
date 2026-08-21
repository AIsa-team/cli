import { execFile, execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { promisify } from "node:util";

/**
 * Installing a coding agent on the user's behalf.
 *
 * Two rules decide everything here:
 *
 * 1. **Never sudo.** A CLI that escalates on a user's machine is a CLI nobody
 *    should trust, and there is no terminal to type a password into anyway.
 *    Where a global npm prefix is not writable we print the command and let
 *    the user run it — the flow resumes on a re-check rather than failing.
 * 2. **Prefer the vendor's own user-space installer.** Claude Code's script
 *    lands in ~/.local/bin, so the permission question never arises. npm is
 *    the fallback, and the one place rule 1 gets exercised.
 *
 * Windows is deliberately out of scope for now: the installers differ
 * (PowerShell, winget) and nothing here has been tested there. `supported()`
 * says so rather than half-working.
 */

const execFileP = promisify(execFile);

export interface Installer {
  id: string;
  label: string;
  /** The binary that must appear on PATH once installed. */
  binary: string;
  /** Preferred command, shown verbatim before it runs. */
  command: string;
  /** Where the preferred command puts things, for the "not on PATH" hint. */
  installDir?: string;
  /** Set when the command is an npm install; enables the broken-install retry. */
  npmPackage?: string;
}

export const INSTALLERS: Record<string, Installer> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    binary: "claude",
    // The vendor installer, which needs no elevated permissions.
    command: "curl -fsSL https://claude.ai/install.sh | bash",
    installDir: "~/.local/bin",
  },
  codex: {
    id: "codex",
    label: "Codex",
    binary: "codex",
    command: "npm install -g @openai/codex",
    npmPackage: "@openai/codex",
  },
};

export function supported(): boolean {
  return process.platform === "darwin" || process.platform === "linux";
}

type Probe = { ok: true } | { ok: false; onPath: boolean; reason: string };

/**
 * Run the binary and report what actually happened, because "not working"
 * has two very different causes with two very different fixes: absent from
 * PATH (fix the PATH) versus present but failing to start (fix the install —
 * seen live when npm's optional-dependency bug installed codex without its
 * platform binary and every invocation threw "Missing optional dependency").
 * The timeout is generous: macOS Gatekeeper can stall a binary's first run.
 */
function probeBinary(binary: string): Probe {
  const res = spawnSync(binary, ["--version"], { timeout: 20_000, encoding: "utf8" });
  if (res.status === 0) return { ok: true };
  if ((res.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    return { ok: false, onPath: false, reason: "not on PATH" };
  }
  const line =
    (res.stderr || res.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.includes("Error") || l.length > 0) ?? `exit status ${res.status}`;
  return { ok: false, onPath: true, reason: line.slice(0, 160) };
}

/** Is the binary already on PATH and able to start? */
export function isInstalled(binary: string): boolean {
  return probeBinary(binary).ok;
}

/**
 * Can we write to npm's global prefix? Asked before running an npm install so
 * the failure is a printed command rather than a wall of EACCES.
 */
export function npmPrefixWritable(): boolean {
  try {
    const prefix = execFileSync("npm", ["config", "get", "prefix"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    if (!prefix || !existsSync(prefix)) return false;
    accessSync(prefix, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export type InstallOutcome =
  | { ok: true; alreadyInstalled: boolean }
  | { ok: false; reason: "unsupported-platform" | "needs-manual"; command: string; detail: string };

/**
 * Install one agent, or explain what the user should run instead.
 *
 * Never throws for an install failure: the caller reports it and the rest of
 * the run continues, because a failed install must not cost the user the MCP
 * servers they also asked for.
 */
export async function installAgent(id: string): Promise<InstallOutcome> {
  const installer = INSTALLERS[id];
  if (!installer) {
    return { ok: false, reason: "needs-manual", command: "", detail: `unknown agent ${id}` };
  }
  if (isInstalled(installer.binary)) return { ok: true, alreadyInstalled: true };
  if (!supported()) {
    return {
      ok: false,
      reason: "unsupported-platform",
      command: installer.command,
      detail: "automatic install is macOS/Linux only for now",
    };
  }
  if (installer.command.startsWith("npm ") && !npmPrefixWritable()) {
    return {
      ok: false,
      reason: "needs-manual",
      command: installer.command,
      detail: "npm's global prefix is not writable by this user",
    };
  }

  try {
    // Shell, because the vendor installer is a pipeline. The command is
    // printed by the caller before this runs; nothing is installed silently.
    await execFileP("/bin/sh", ["-c", installer.command], { timeout: 300_000 });
  } catch (e) {
    return {
      ok: false,
      reason: "needs-manual",
      command: installer.command,
      detail: (e as Error).message.split("\n")[0],
    };
  }

  let probe = probeBinary(installer.binary);
  if (!probe.ok && probe.onPath && installer.npmPackage) {
    // The binary exists but cannot start — npm's optional-dependency bug
    // leaves exactly this (package installed, platform binary missing, exit 0
    // all the way). The reliable remedy is a clean uninstall + reinstall, so
    // a broken npm install gets exactly one.
    await execFileP(
      "/bin/sh",
      ["-c", `npm uninstall -g ${installer.npmPackage}; ${installer.command}`],
      { timeout: 300_000 }
    ).catch(() => {});
    probe = probeBinary(installer.binary);
  }
  if (!probe.ok) {
    return {
      ok: false,
      reason: "needs-manual",
      command: installer.command,
      detail: !probe.onPath
        ? installer.installDir
          ? `installed, but ${installer.binary} is not on PATH — add ${installer.installDir} to it`
          : `install reported success but ${installer.binary} is not on PATH`
        : `installed, but ${installer.binary} fails to start: ${probe.reason}`,
    };
  }
  return { ok: true, alreadyInstalled: false };
}
