import { describe, expect, it } from "vitest";
import { CATEGORY_BLURB, categoryBlurb } from "../src/commands/flow.js";
import { fetchLiveServers } from "../src/commands/mcp.js";

/**
 * Every category the host publishes must have a line of copy, including new
 * categories that arrive without a client release.
 *
 * The blurb map is written by hand and the categories come from the MCP host,
 * so the two drift the moment a server ships under a new one — silently,
 * because the page renders a missing blurb as an empty string. That is how
 * the largest area on the capability step came to show nothing but a number
 * while the four beside it explained themselves.
 *
 * The check runs against the live host and skips itself when that is not
 * reachable: a category with no copy is a real gap, but a network that is
 * down is not a reason to fail someone's build.
 */
describe("category copy keeps up with the host", () => {
  it("every live category has a blurb", async () => {
    let servers;
    try {
      servers = await fetchLiveServers();
    } catch {
      return; // offline; the gap this guards is not visible from here
    }
    const categories = [...new Set(servers.map((s) => s.category).filter(Boolean))];
    for (const category of categories) {
      const text = categoryBlurb(category, servers.filter((s) => s.category === category));
      expect(text.en.trim(), category).not.toBe("");
      expect(text.zh.trim(), category).not.toBe("");
    }
  });

  it("uses host server names for an unknown category while preserving curated copy", () => {
    expect(categoryBlurb("new-category", [{ name: "New live API" }])).toEqual({
      en: "Explore New live API.", zh: "查看 New live API 的接口。",
    });
    expect(categoryBlurb("Finance", [{ name: "New live API" }])).toBe(CATEGORY_BLURB.Finance);
  });

  it.each(["constructor", "toString", "__proto__"])("handles category %s as host data", (category) => {
    expect(categoryBlurb(category, [{ name: "New live API" }]).en).toBe("Explore New live API.");
  });
});
