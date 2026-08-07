import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tree = {
  tree: [
    { path: "README.md", type: "blob", sha: "r1" },
    { path: "financial", type: "tree", sha: "t1" },
    { path: "financial/marketpulse/SKILL.md", type: "blob", sha: "s1" },
    { path: "financial/marketpulse/scripts/client.py", type: "blob", sha: "s2" },
    { path: "financial/market/SKILL.md", type: "blob", sha: "s3" },
    { path: "search-research/multi-search/SKILL.md", type: "blob", sha: "s4" },
  ],
};

let cacheDir: string;

async function freshRegistry() {
  vi.resetModules();
  return import("../src/skills-registry.js");
}

describe("skills registry", () => {
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "aisa-cache-"));
    process.env.AISA_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.AISA_CACHE_DIR;
    vi.unstubAllGlobals();
  });

  it("derives two-level slugs from SKILL.md locations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tree), { status: 200 })));
    const { getSkillIndex } = await freshRegistry();

    const index = await getSkillIndex();
    expect(index.slugs).toEqual([
      "financial/market",
      "financial/marketpulse",
      "search-research/multi-search",
    ]);
    // Files must attach to the longest matching slug, not the first prefix hit.
    expect(index.blobs["financial/marketpulse"].map((b) => b.path)).toContain(
      "financial/marketpulse/scripts/client.py"
    );
    expect(index.blobs["financial/market"]).toEqual([
      { path: "financial/market/SKILL.md", sha: "s3" },
    ]);
  });

  it("fetches the tree once per process no matter how many commands ask for it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(tree), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { getSkillIndex } = await freshRegistry();

    await Promise.all([getSkillIndex(), getSkillIndex(), getSkillIndex()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves a bare name to its canonical slug", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tree), { status: 200 })));
    const { getSkillIndex, resolveSlug } = await freshRegistry();
    const index = await getSkillIndex();

    expect(resolveSlug("marketpulse", index)).toBe("financial/marketpulse");
    expect(resolveSlug("financial/marketpulse", index)).toBe("financial/marketpulse");
    expect(() => resolveSlug("nope", index)).toThrow(/No skill/);
  });

  it("reports ambiguity instead of picking a skill", async () => {
    const dupes = {
      tree: [
        { path: "a/market/SKILL.md", type: "blob", sha: "x1" },
        { path: "b/market/SKILL.md", type: "blob", sha: "x2" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dupes), { status: 200 })));
    const { getSkillIndex, resolveSlug } = await freshRegistry();
    const index = await getSkillIndex();

    expect(() => resolveSlug("market", index)).toThrow(/Ambiguous/);
  });
});
