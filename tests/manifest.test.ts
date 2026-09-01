import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildManifest, descend } from "../src/commands/manifest.js";

/**
 * The manifest exists because `--help` hides what an agent needs: Commander
 * renders every subcommand as a bare `[options]`, so the flags never reach the
 * page and a nested tree like `aisa api ...` is invisible from the top. An LLM
 * given only the help text invented `--json` (the real flag is `--raw`) and
 * could not find `api show` at all.
 *
 * These tests pin the properties that made those two failures go away.
 */

function fixture(): Command {
  const program = new Command();
  program.name("aisa").description("root");

  const api = program.command("api").description("Discover and inspect APIs");
  api
    .command("show <api> [path]")
    .description("Show an API's endpoints")
    .option("--all", "Show every endpoint instead of the first 40")
    .option("--limit <n>", "Max results", "20");

  program
    .command("__complete [words...]", { hidden: true })
    .description("shell plumbing");

  return program;
}

const find = (m: ReturnType<typeof buildManifest>, path: string): ReturnType<typeof buildManifest> | undefined => {
  if (m.path === path) return m;
  for (const s of m.subcommands) {
    const hit = find(s, path);
    if (hit) return hit;
  }
  return undefined;
};

describe("buildManifest", () => {
  it("reaches nested subcommands the top-level help never shows", () => {
    const m = buildManifest(fixture());
    expect(find(m, "aisa api show")).toBeDefined();
  });

  it("enumerates flags, so an agent never has to guess one", () => {
    const show = find(buildManifest(fixture()), "aisa api show");
    expect(show?.options.map((o) => o.flags)).toEqual(["--all", "--limit <n>"]);
  });

  it("does not call an optional flag required — Commander's `required` means the VALUE", () => {
    const show = find(buildManifest(fixture()), "aisa api show");
    const limit = show?.options.find((o) => o.flags === "--limit <n>");
    // --limit is entirely optional, it just happens to take a value.
    expect(limit?.mandatory).toBe(false);
    expect(limit?.value).toBe("required");
    expect(show?.options.find((o) => o.flags === "--all")?.value).toBe("none");
  });

  it("marks a genuinely mandatory option", () => {
    const program = new Command();
    program.name("aisa");
    program.command("x").requiredOption("--key <k>", "needed");
    const x = find(buildManifest(program), "aisa x");
    expect(x?.options.find((o) => o.flags === "--key <k>")?.mandatory).toBe(true);
  });

  it("carries defaults, which the flag name alone does not imply", () => {
    const show = find(buildManifest(fixture()), "aisa api show");
    expect(show?.options.find((o) => o.flags === "--limit <n>")?.default).toBe("20");
    expect(show?.options.find((o) => o.flags === "--all")?.default).toBeUndefined();
  });

  it("records which positional arguments are required", () => {
    const show = find(buildManifest(fixture()), "aisa api show");
    expect(show?.arguments).toEqual([
      { name: "api", description: "", required: true, variadic: false },
      { name: "path", description: "", required: false, variadic: false },
    ]);
  });

  it("omits hidden commands — shell plumbing is not a feature to call", () => {
    const m = buildManifest(fixture());
    expect(find(m, "aisa __complete")).toBeUndefined();
  });

  it("paths are the command line to type, not just the leaf name", () => {
    const show = find(buildManifest(fixture()), "aisa api show");
    expect(show?.path).toBe("aisa api show");
  });

  it("is JSON-serialisable end to end", () => {
    expect(() => JSON.parse(JSON.stringify(buildManifest(fixture())))).not.toThrow();
  });
});

/**
 * The whole tree is ~15k tokens. An agent that needs one command should not
 * have to read the definition of 87 to find it, so the path argument is what
 * makes the manifest affordable to actually use.
 */
describe("scoping by command path", () => {
  it("returns just the named subtree", () => {
    const root = buildManifest(fixture());
    const api = descend(root, ["api"]);
    expect(api?.path).toBe("aisa api");
    expect(api?.subcommands.map((c) => c.path)).toEqual(["aisa api show"]);
  });

  it("reaches a leaf, which is a fraction of the full dump", () => {
    const root = buildManifest(fixture());
    const leaf = descend(root, ["api", "show"]);
    expect(leaf?.path).toBe("aisa api show");
    expect(JSON.stringify(leaf).length).toBeLessThan(JSON.stringify(root).length);
  });

  it("returns undefined for a path that does not exist", () => {
    const root = buildManifest(fixture());
    expect(descend(root, ["api", "nope"])).toBeUndefined();
    expect(descend(root, ["nope"])).toBeUndefined();
  });
});
