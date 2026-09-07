import { fileURLToPath } from "node:url";

/**
 * How this copy of the CLI got onto the machine.
 *
 * `aisa update` used to run `npm install -g @aisa-one/cli@latest` no matter
 * how the caller had installed it. For a pnpm or bun user that does not
 * update anything — it installs a *second* copy under npm's prefix, which
 * then shadows theirs or is shadowed by it depending on PATH order, and the
 * version they see afterwards is whichever won. For someone running through
 * `npx` it is stranger still: npx already resolves the latest published
 * version on every invocation, so there was nothing to update in the first
 * place and the command silently installed a global they never asked for.
 *
 * There is no manifest recording the installer, so this reads the one thing
 * that does remember: where the running file sits on disk. Each package
 * manager has its own place, and none of them look alike.
 */
export type InstallKind = "npx" | "npm" | "pnpm" | "bun" | "yarn" | "source" | "unknown";

export interface InstallMethod {
  kind: InstallKind;
  /** The path the verdict was read from — worth printing when it is unknown. */
  path: string;
  /**
   * What would update it, or undefined when nothing would: npx is current by
   * definition, and a working copy is updated with git.
   */
  command?: string;
}

const PACKAGE = "@aisa-one/cli";

/**
 * Read the verdict off a path.
 *
 * Separate from the caller so it can be tested against the shapes each
 * manager produces without installing five package managers.
 */
export function classifyPath(p: string): InstallKind {
  const s = p.replace(/\\/g, "/");
  // npx first: its cache sits under the npm cache directory, so a test for
  // node_modules alone would call it an npm install.
  if (/\/_npx\//.test(s)) return "npx";
  if (/\/\.bun\//.test(s)) return "bun";
  // pnpm's global root, and its content-addressed store — a global install
  // links into node_modules/.pnpm rather than copying.
  if (/\/pnpm\/|\/\.pnpm\//.test(s)) return "pnpm";
  if (/\/\.yarn\/|\/yarn\/(global|link)\//.test(s)) return "yarn";
  // Anything still inside a node_modules for this package is a plain install;
  // outside one, it is a checkout being run from its own dist.
  if (s.includes(`/node_modules/${PACKAGE}/`)) return "npm";
  if (/\/node_modules\//.test(s)) return "npm";
  return "source";
}

const COMMAND: Partial<Record<InstallKind, string>> = {
  npm: `npm install -g ${PACKAGE}@latest`,
  pnpm: `pnpm add -g ${PACKAGE}@latest`,
  bun: `bun add -g ${PACKAGE}@latest`,
  yarn: `yarn global add ${PACKAGE}@latest`,
};

/** Where this process is running from, and what would update it. */
export function detectInstall(from = import.meta.url): InstallMethod {
  let path: string;
  try {
    path = fileURLToPath(from);
  } catch {
    path = from;
  }
  const kind = classifyPath(path);
  return { kind, path, command: COMMAND[kind] };
}
