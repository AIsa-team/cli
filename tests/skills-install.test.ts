import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tree = {
  tree: [
    { path: "financial/marketpulse/SKILL.md", type: "blob", sha: "s1" },
    { path: "financial/marketpulse/scripts/client.py", type: "blob", sha: "s2" },
    { path: "financial/marketpulse/logo.png", type: "blob", sha: "s3" },
  ],
};

const SKILL_MD = "---\nname: marketpulse\ndescription: test\n---\n\nbody\n";

let home: string;
let cacheDir: string;

function skillDir(): string {
  return join(home, ".claude", "skills", "marketpulse");
}

/** Serve the tree, and each file unless its path is in `broken`. */
function stubGitHub(broken: string[] = []): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify(tree), { status: 200 });
    }
    if (broken.some((b) => url.endsWith(b))) {
      return new Response("not found", { status: 404 });
    }
    return new Response(url.endsWith("SKILL.md") ? SKILL_MD : "content", { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function freshInstall() {
  vi.resetModules();
  return import("../src/commands/skills.js");
}

describe("skills install", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aisa-home-"));
    cacheDir = mkdtempSync(join(tmpdir(), "aisa-cache-"));
    process.env.HOME = home;
    process.env.AISA_CACHE_DIR = cacheDir;
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.AISA_CACHE_DIR;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes every file plus an ownership marker", async () => {
    stubGitHub();
    const { skillsInstallAction } = await freshInstall();

    await skillsInstallAction("marketpulse", { agent: "claude" });

    expect(existsSync(join(skillDir(), "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir(), "scripts", "client.py"))).toBe(true);
    const marker = JSON.parse(readFileSync(join(skillDir(), ".aisa-skill.json"), "utf-8"));
    expect(marker.slug).toBe("financial/marketpulse");
  });

  it("replaces the directory instead of merging into it", async () => {
    stubGitHub();
    const { skillsInstallAction } = await freshInstall();

    await skillsInstallAction("marketpulse", { agent: "claude" });
    // A file only the previous version shipped; an agent would keep loading it.
    writeFileSync(join(skillDir(), "stale.py"), "old", "utf-8");

    await skillsInstallAction("marketpulse", { agent: "claude" });
    expect(existsSync(join(skillDir(), "stale.py"))).toBe(false);
    expect(existsSync(join(skillDir(), "SKILL.md"))).toBe(true);
  });

  it("aborts and keeps the existing skill when a file fails to download", async () => {
    stubGitHub();
    const { skillsInstallAction } = await freshInstall();
    await skillsInstallAction("marketpulse", { agent: "claude" });
    writeFileSync(join(skillDir(), "SKILL.md"), "PREVIOUS WORKING VERSION", "utf-8");

    // Install replaces the directory, so a partial download must not proceed:
    // it would delete a working skill and leave an incomplete one behind.
    stubGitHub(["scripts/client.py"]);
    const { skillsInstallAction: retry } = await freshInstall();
    await retry("marketpulse", { agent: "claude" });

    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf-8")).toBe("PREVIOUS WORKING VERSION");
  });

  it("refuses to replace an unmarked directory when a category was named", async () => {
    // Pre-0.2.3 installs have no marker. Frontmatter `name:` cannot prove
    // ownership, because another category may ship a skill with the same leaf
    // name and the same `name:`.
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "SKILL.md"), "---\nname: marketpulse\n---\nLEGACY", "utf-8");

    stubGitHub();
    const { skillsInstallAction } = await freshInstall();
    await skillsInstallAction("financial/marketpulse", { agent: "claude" });

    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf-8")).toContain("LEGACY");
  });

  it("--force replaces an unmarked directory", async () => {
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "SKILL.md"), "---\nname: marketpulse\n---\nLEGACY", "utf-8");

    stubGitHub();
    const { skillsInstallAction } = await freshInstall();
    await skillsInstallAction("financial/marketpulse", { agent: "claude", force: true });

    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf-8")).not.toContain("LEGACY");
    expect(existsSync(join(skillDir(), ".aisa-skill.json"))).toBe(true);
  });

  it("upgrades an unmarked directory when asked by bare name", async () => {
    // A bare name only resolves when the leaf is unique repo-wide, so whatever
    // holds the directory has to be this skill — no ambiguity to guard against.
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "SKILL.md"), "---\nname: marketpulse\n---\nLEGACY", "utf-8");

    stubGitHub();
    const { skillsInstallAction } = await freshInstall();
    await skillsInstallAction("marketpulse", { agent: "claude" });

    expect(readFileSync(join(skillDir(), "SKILL.md"), "utf-8")).not.toContain("LEGACY");
  });

  it("refuses to merge into a directory that is not a recognizable skill install", async () => {
    // No marker and no readable SKILL.md — an interrupted install or a user's
    // own directory. Writing into it would merge, breaking replace-not-merge;
    // deleting it silently would destroy data we cannot identify.
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "my-notes.txt"), "user data", "utf-8");

    stubGitHub();
    const { skillsInstallAction } = await freshInstall();
    await skillsInstallAction("marketpulse", { agent: "claude" });

    expect(readFileSync(join(skillDir(), "my-notes.txt"), "utf-8")).toBe("user data");
    expect(existsSync(join(skillDir(), "SKILL.md"))).toBe(false);
  });

  it("--force replaces an unrecognizable directory wholesale, leaving no leftovers", async () => {
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "my-notes.txt"), "user data", "utf-8");

    stubGitHub();
    const { skillsInstallAction } = await freshInstall();
    await skillsInstallAction("marketpulse", { agent: "claude", force: true });

    expect(existsSync(join(skillDir(), "my-notes.txt"))).toBe(false);
    expect(existsSync(join(skillDir(), "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillDir(), ".aisa-skill.json"))).toBe(true);
  });

  it("does not install anything when SKILL.md itself fails", async () => {
    stubGitHub(["SKILL.md"]);
    const { skillsInstallAction } = await freshInstall();

    await skillsInstallAction("marketpulse", { agent: "claude" });
    expect(existsSync(skillDir())).toBe(false);
  });
});

describe("skills remove", () => {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "aisa-home-"));
    cacheDir = mkdtempSync(join(tmpdir(), "aisa-cache-"));
    process.env.HOME = home;
    process.env.AISA_CACHE_DIR = cacheDir;
    mkdirSync(skillDir(), { recursive: true });
    writeFileSync(join(skillDir(), "SKILL.md"), SKILL_MD, "utf-8");
    writeFileSync(
      join(skillDir(), ".aisa-skill.json"),
      JSON.stringify({ slug: "financial/marketpulse", installedAt: "2026-01-01T00:00:00Z" }),
      "utf-8"
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
    delete process.env.AISA_CACHE_DIR;
    vi.restoreAllMocks();
  });

  it("refuses to delete a directory holding a different canonical slug", async () => {
    const { skillsRemoveAction } = await freshInstall();
    skillsRemoveAction("other-category/marketpulse", { agent: "claude" });
    expect(existsSync(skillDir())).toBe(true);
  });

  it("removes when the canonical slug matches", async () => {
    const { skillsRemoveAction } = await freshInstall();
    skillsRemoveAction("financial/marketpulse", { agent: "claude" });
    expect(existsSync(skillDir())).toBe(false);
  });

  it("removes on a bare name, which names whatever holds the directory", async () => {
    const { skillsRemoveAction } = await freshInstall();
    skillsRemoveAction("marketpulse", { agent: "claude" });
    expect(existsSync(skillDir())).toBe(false);
  });

  it("--force overrides the slug check", async () => {
    const { skillsRemoveAction } = await freshInstall();
    skillsRemoveAction("other-category/marketpulse", { agent: "claude", force: true });
    expect(existsSync(skillDir())).toBe(false);
  });

  it("refuses a canonical removal of an unmarked directory", async () => {
    // Could be a same-named skill from another category installed pre-0.2.3.
    rmSync(join(skillDir(), ".aisa-skill.json"));
    const { skillsRemoveAction } = await freshInstall();

    skillsRemoveAction("financial/marketpulse", { agent: "claude" });
    expect(existsSync(skillDir())).toBe(true);

    skillsRemoveAction("financial/marketpulse", { agent: "claude", force: true });
    expect(existsSync(skillDir())).toBe(false);
  });

  it("still removes an unmarked directory by bare name", async () => {
    rmSync(join(skillDir(), ".aisa-skill.json"));
    const { skillsRemoveAction } = await freshInstall();
    skillsRemoveAction("marketpulse", { agent: "claude" });
    expect(existsSync(skillDir())).toBe(false);
  });
});
