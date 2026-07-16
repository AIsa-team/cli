import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentUpdateAction } from "../src/commands/agent.js";
import { profileDir, writeMarker, readMarker } from "../src/agent/installer.js";
import { makeArtifact, indexFor } from "./helpers/agent-fixtures.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-hh-"));
  mkdirSync(join(home, "profiles"), { recursive: true });
  process.env.HERMES_HOME = home;
  process.env.AISA_API_KEY = "sk-test";
});
afterEach(() => { delete process.env.HERMES_HOME; delete process.env.AISA_API_KEY; });

describe("update", () => {
  it("updates an outdated agent, skips pinned and current ones", async () => {
    const { buf, sha } = await makeArtifact("2.0.0");
    const INDEX = indexFor("demo", "2.0.0", sha);
    const fetchImpl = async (url: string) =>
      url.endsWith("index.json")
        ? new Response(JSON.stringify(INDEX), { status: 200 })
        : new Response(buf, { status: 200 });
    const exec = async () => ({ code: 0, stdout: "", stderr: "" });

    for (const [id, version, pinned] of [
      ["demo", "1.0.0", false], ["pinned-agent", "1.0.0", true],
    ] as const) {
      const dir = profileDir(id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, ".env"), "PROFILE_ID=x\n");
      await writeMarker(dir, { id, version, target: "hermes", pinned });
    }

    const results = await agentUpdateAction(undefined, {}, { fetchImpl: fetchImpl as any, exec });
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    expect(byId["demo"].status).toBe("updated");
    expect(byId["demo"].to).toBe("2.0.0");
    expect(byId["pinned-agent"].status).toBe("pinned");
    expect((await readMarker(profileDir("demo")))?.version).toBe("2.0.0");
  });
});
