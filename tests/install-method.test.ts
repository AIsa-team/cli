import { describe, expect, it } from "vitest";
import { classifyPath, detectInstall } from "../src/utils/install-method.js";

/**
 * The shapes each package manager actually produces.
 *
 * Collected from real installs rather than invented: the point of this table
 * is that `aisa update` runs the right manager's command, and a made-up path
 * would only prove the regex matches itself.
 */
const PATHS: Array<[string, string, ReturnType<typeof classifyPath>]> = [
  ["npm global (homebrew node)", "/opt/homebrew/lib/node_modules/@aisa-one/cli/dist/index.js", "npm"],
  ["npm global (nvm)", "/Users/x/.nvm/versions/node/v24.9.0/lib/node_modules/@aisa-one/cli/dist/index.js", "npm"],
  ["npx cache", "/Users/x/.npm/_npx/1a3c4333f3a90708/node_modules/@aisa-one/cli/dist/index.js", "npx"],
  ["pnpm global", "/Users/x/Library/pnpm/global/5/node_modules/@aisa-one/cli/dist/index.js", "pnpm"],
  ["pnpm store link", "/Users/x/.local/share/pnpm/global/5/.pnpm/@aisa-one+cli@0.3.0/node_modules/@aisa-one/cli/dist/index.js", "pnpm"],
  ["bun global", "/Users/x/.bun/install/global/node_modules/@aisa-one/cli/dist/index.js", "bun"],
  ["yarn global", "/Users/x/.yarn/berry/cache/@aisa-one-cli/dist/index.js", "yarn"],
  ["a working copy", "/Users/x/AIsa-team/cli/dist/index.js", "source"],
  ["windows npm global", "C:\\\\Users\\\\x\\\\AppData\\\\Roaming\\\\npm\\\\node_modules\\\\@aisa-one\\\\cli\\\\dist\\\\index.js", "npm"],
];

describe("install method", () => {
  for (const [name, path, want] of PATHS) {
    it(`recognises ${name}`, () => {
      expect(classifyPath(path)).toBe(want);
    });
  }

  it("offers nothing to run for the two that cannot be updated this way", () => {
    // npx is current on every invocation; a checkout is updated with git.
    // Both used to get `npm install -g`, which installed a second copy.
    expect(detectInstall("file:///Users/x/.npm/_npx/abc/node_modules/@aisa-one/cli/dist/index.js").command).toBeUndefined();
    expect(detectInstall("file:///Users/x/src/cli/dist/index.js").command).toBeUndefined();
  });

  it("names the right manager for each of the rest", () => {
    const cmd = (p: string) => detectInstall("file://" + p).command;
    expect(cmd("/opt/homebrew/lib/node_modules/@aisa-one/cli/dist/index.js")).toContain("npm install -g");
    expect(cmd("/Users/x/Library/pnpm/global/5/node_modules/@aisa-one/cli/dist/index.js")).toContain("pnpm add -g");
    expect(cmd("/Users/x/.bun/install/global/node_modules/@aisa-one/cli/dist/index.js")).toContain("bun add -g");
  });
});
