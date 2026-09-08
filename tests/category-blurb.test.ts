import { describe, expect, it } from "vitest";
import { CATEGORY_BLURB } from "../src/commands/flow.js";
import { fetchLiveServers } from "../src/commands/mcp.js";

/**
 * Every category the host publishes must have a line of copy.
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
    let categories: string[];
    try {
      const servers = await fetchLiveServers();
      categories = [...new Set(servers.map((s) => s.category).filter(Boolean))];
    } catch {
      return; // offline; the gap this guards is not visible from here
    }
    if (categories.length === 0) return;
    const missing = categories.filter((c) => !CATEGORY_BLURB[c]);
    expect(missing, `categories with no line of copy: ${missing.join(", ")}`).toEqual([]);
  });
});
