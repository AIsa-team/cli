import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar";
import {
  hermesRoot, profileDir, downloadArtifact, extractBundle,
  readBundleManifest, writeMarker, readMarker, listInstalled,
} from "../src/agent/installer.js";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "aisa-hh-")); process.env.HERMES_HOME = home; });
afterEach(() => { delete process.env.HERMES_HOME; });

async function makeBundleTar(): Promise<Buffer> {
  const src = mkdtempSync(join(tmpdir(), "aisa-bundle-"));
  mkdirSync(join(src, "profile", "cron"), { recursive: true });
  writeFileSync(join(src, "profile", "SOUL.template.md"), "# soul");
  mkdirSync(join(src, "skills", "hello"), { recursive: true });
  writeFileSync(join(src, "skills", "hello", "SKILL.md"), "---\nname: hello\n---");
  writeFileSync(join(src, "agent.json"), JSON.stringify({
    spec: "agentspec/v1", id: "demo", name: "Demo", version: "0.1.0", description: "d",
    language: "en", models: { default: "deepseek-v3.2", provider: "aisa" },
    env: { required: [{ name: "AISA_API_KEY", description: "k" }], optional: [] },
    skills: { inline: [], remote: [] }, update: { channel: "latest", auto: true },
  }));
  writeFileSync(join(src, ".env.example"), "PROFILE_ID=demo\nAISA_API_KEY=\n");
  const file = join(src, "..", `bundle-${Date.now()}.tar.gz`);
  await tar.c({ gzip: true, file, cwd: src }, ["profile", "skills", "agent.json", ".env.example"]);
  return readFileSync(file) as Buffer;
}

describe("installer", () => {
  it("hermesRoot honors HERMES_HOME; profileDir composes", () => {
    expect(hermesRoot()).toBe(home);
    expect(profileDir("demo")).toBe(join(home, "profiles", "demo"));
  });

  it("downloadArtifact verifies sha256", async () => {
    const buf = Buffer.from("artifact-bytes");
    const sha = createHash("sha256").update(buf).digest("hex");
    const fakeFetch = async () => new Response(buf, { status: 200 });
    expect((await downloadArtifact("https://x/a.tar.gz", sha, fakeFetch as any)).equals(buf)).toBe(true);
    await expect(downloadArtifact("https://x/a.tar.gz", "0".repeat(64), fakeFetch as any))
      .rejects.toThrow(/sha256/i);
  });

  it("extractBundle promotes profile/ to the root and keeps skills/agent.json", async () => {
    const dest = profileDir("demo");
    await extractBundle(await makeBundleTar(), dest);
    expect(existsSync(join(dest, "SOUL.template.md"))).toBe(true);
    expect(existsSync(join(dest, "profile"))).toBe(false);
    expect(existsSync(join(dest, "skills", "hello", "SKILL.md"))).toBe(true);
    const m = await readBundleManifest(dest);
    expect(m.id).toBe("demo");
  });

  it("marker round-trips and listInstalled finds it", async () => {
    const dest = profileDir("demo");
    await extractBundle(await makeBundleTar(), dest);
    await writeMarker(dest, { id: "demo", version: "0.1.0", target: "hermes", pinned: false });
    expect((await readMarker(dest))?.version).toBe("0.1.0");
    const all = await listInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].marker.id).toBe("demo");
  });
});
