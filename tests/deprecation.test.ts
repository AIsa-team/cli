import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildManifest } from "../src/commands/manifest.js";
import { deprecationFor, warnDeprecated, withDeprecation } from "../src/deprecation.js";

describe("deprecation metadata", () => {
  afterEach(() => vi.restoreAllMocks());

  it("covers the three retained legacy surfaces", () => {
    expect(deprecationFor("api search")?.replacement).toBe("search");
    expect(deprecationFor("api show")?.replacement).toBe("schema");
    expect(deprecationFor("run")?.replacement).toBe("call");
    for (const path of ["api search", "api show", "run"]) {
      expect(deprecationFor(path)?.migration).toMatch(/separately announced/);
      expect(deprecationFor(path)?.migration).not.toMatch(/v0\.|2026/);
    }
  });

  it("warns on stderr only and leaves the original action's stdout untouched", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fn = withDeprecation("api search", (value: string) => {
      console.log(value);
      return value;
    });

    expect(fn('{"providers":[],"endpoints":[]}')).toBe('{"providers":[],"endpoints":[]}');
    expect(log.mock.calls[0][0]).toBe('{"providers":[],"endpoints":[]}');
    expect(err.mock.calls.join("\n")).toMatch(/deprecated: aisa api search/);
    expect(err.mock.calls.join("\n")).not.toContain('{"providers"');
  });

  it("attaches deprecated, replacement, and migration to the manifest", () => {
    const program = new Command();
    program.name("aisa");
    const api = program.command("api").description("Discover and inspect APIs");
    api.command("search <query>").description("Search APIs");
    api.command("show <api> [path]").description("Show endpoints");
    api.command("list").description("List APIs");
    program.command("run <slug> <path>").description("Execute an API call");

    const root = buildManifest(program);
    const find = (path: string) => {
      const walk = (node: ReturnType<typeof buildManifest>): ReturnType<typeof buildManifest> | undefined => {
        if (node.path === path) return node;
        for (const child of node.subcommands) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return undefined;
      };
      return walk(root);
    };

    const search = find("aisa api search");
    expect(search?.deprecated).toBe(true);
    expect(search?.replacement).toBe("search");
    expect(search?.migration).toMatch(/Router/);

    const show = find("aisa api show");
    expect(show?.deprecated).toBe(true);
    expect(show?.replacement).toBe("schema");

    const run = find("aisa run");
    expect(run?.deprecated).toBe(true);
    expect(run?.replacement).toBe("call");

    expect(find("aisa api list")?.deprecated).toBeUndefined();
  });

  it("writes the warning through warnDeprecated", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    warnDeprecated("run");
    expect(err.mock.calls[0][0]).toMatch(/deprecated: aisa run/);
  });
});
