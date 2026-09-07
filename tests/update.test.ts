import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `aisa update` has to get four things right without ever touching a real
 * registry: it must not run npm when the registry is unreachable, must not
 * run npm when the global prefix cannot be written (no-sudo policy, same as
 * install.ts), must report "already latest" rather than a false success when
 * the binary reports the same version before and after, and must report the
 * actual before/after when it changes.
 *
 * And a fifth, added later: it must run the manager that actually installed
 * this copy. It used to run `npm install -g` regardless, which for a pnpm or
 * bun user installs a second copy rather than updating theirs, and for an
 * npx user installs a global they never asked for.
 */

type Channel =
  | { kind: "official" }
  | { kind: "mirror"; registry: string }
  | { kind: "offline" };

let channel: Channel;
let prefixWritable: boolean;
let shellOk: boolean;
let versions: string[]; // shifted once per --version probe: [before, after]

vi.mock("../src/commands/install.js", () => ({
  pickNpmChannel: async () => channel,
  npmPrefixWritable: () => prefixWritable,
}));

let install: { kind: string; path: string; command?: string };

vi.mock("../src/utils/install-method.js", () => ({
  detectInstall: () => install,
}));

vi.mock("../src/utils/update-check.js", () => ({
  checkForUpdate: async () => undefined,
}));

vi.mock("../src/utils/exec.js", () => ({
  runShell: async () => (shellOk ? { ok: true, stdout: "", stderr: "", detail: "" } : { ok: false, stdout: "", stderr: "", detail: "network error" }),
  runSync: () => {
    const v = versions.shift();
    return v !== undefined ? { status: 0, stdout: v, stderr: "" } : { status: 1, stdout: "", stderr: "" };
  },
  QUICK_TIMEOUT_MS: 20_000,
}));

async function freshUpdate() {
  vi.resetModules();
  return import("../src/commands/update.js");
}

describe("updateAction", () => {
  let logged: string[];

  beforeEach(() => {
    channel = { kind: "official" };
    prefixWritable = true;
    shellOk = true;
    versions = ["0.3.0", "0.4.0"];
    install = {
      kind: "npm",
      path: "/opt/homebrew/lib/node_modules/@aisa-one/cli/dist/index.js",
      command: "npm install -g @aisa-one/cli@latest",
    };
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("reports the version change on a real update", async () => {
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(logged.some((l) => l.includes("0.3.0") && l.includes("0.4.0"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("reports already-latest without calling it a failure", async () => {
    versions = ["0.4.0", "0.4.0"];
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(logged.some((l) => l.toLowerCase().includes("already"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it("refuses to run npm when the registry is unreachable", async () => {
    channel = { kind: "offline" };
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(process.exitCode).toBe(1);
    expect(logged.some((l) => l.toLowerCase().includes("registry"))).toBe(true);
  });

  it("refuses to run npm when the global prefix is not writable", async () => {
    prefixWritable = false;
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(process.exitCode).toBe(1);
    expect(logged.some((l) => l.toLowerCase().includes("prefix"))).toBe(true);
  });

  it("reports failure and the manual command when the install itself fails", async () => {
    shellOk = false;
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(process.exitCode).toBe(1);
    expect(logged.some((l) => l.includes("npm install -g @aisa-one/cli@latest"))).toBe(true);
  });

  it("adds the mirror registry flag to the printed and run command", async () => {
    channel = { kind: "mirror", registry: "https://registry.npmmirror.com" };
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(logged.some((l) => l.includes("--registry=https://registry.npmmirror.com"))).toBe(true);
  });

  it("runs pnpm for a pnpm install, and never npm", async () => {
    install = { kind: "pnpm", path: "/Users/x/Library/pnpm/global/5/node_modules/@aisa-one/cli/dist/index.js", command: "pnpm add -g @aisa-one/cli@latest" };
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(logged.some((l) => l.includes("pnpm add -g"))).toBe(true);
    expect(logged.some((l) => l.includes("npm install -g"))).toBe(false);
  });

  it("installs nothing when the caller is running through npx", async () => {
    install = { kind: "npx", path: "/Users/x/.npm/_npx/abc/node_modules/@aisa-one/cli/dist/index.js" };
    shellOk = false; // would surface as a failure if it ran anything at all
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(process.exitCode).toBeUndefined();
    expect(logged.some((l) => l.toLowerCase().includes("npx"))).toBe(true);
  });

  it("refuses to touch a working copy", async () => {
    install = { kind: "source", path: "/Users/x/src/cli/dist/index.js" };
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(process.exitCode).toBe(1);
    expect(logged.some((l) => l.includes("git"))).toBe(true);
  });

  it("prints the command rather than guessing when it cannot tell", async () => {
    install = { kind: "unknown", path: "/somewhere/odd/index.js" };
    const { updateAction } = await freshUpdate();
    await updateAction();
    expect(process.exitCode).toBe(1);
    expect(logged.some((l) => l.includes("npm install -g @aisa-one/cli@latest"))).toBe(true);
  });
});
