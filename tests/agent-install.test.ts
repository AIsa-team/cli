import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentInstallAction } from "../src/commands/agent.js";
import { profileDir, readMarker } from "../src/agent/installer.js";
import { makeArtifact, indexFor } from "./helpers/agent-fixtures.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-hh-"));
  mkdirSync(join(home, "profiles"), { recursive: true });
  process.env.HERMES_HOME = home;
  process.env.AISA_API_KEY = "sk-test";
});
afterEach(() => { delete process.env.HERMES_HOME; delete process.env.AISA_API_KEY; });

describe("install", () => {
  it("installs end to end: extract, env, render, marker", async () => {
    const { buf, sha } = await makeArtifact();
    const INDEX = indexFor("demo", "1.0.0", sha);
    const fetchImpl = async (url: string) =>
      url.endsWith("index.json")
        ? new Response(JSON.stringify(INDEX), { status: 200 })
        : new Response(buf, { status: 200 });
    const execCalls: string[][] = [];
    const exec = async (cmd: string, args: string[]) =>
      (execCalls.push([cmd, ...args]), { code: 0, stdout: "", stderr: "" });

    await agentInstallAction("demo", {}, { fetchImpl: fetchImpl as any, exec });

    const dir = profileDir("demo");
    expect(existsSync(join(dir, "SOUL.template.md"))).toBe(true);
    expect(readFileSync(join(dir, ".env"), "utf8")).toContain("AISA_API_KEY=sk-test");
    expect(execCalls[0][0]).toBe("bash");
    expect(execCalls[0][1]).toContain("render.sh");
    expect((await readMarker(dir))?.version).toBe("1.0.0");
  });

  it("preserves an existing .env on reinstall", async () => {
    const { buf, sha } = await makeArtifact();
    const INDEX = indexFor("demo", "1.0.0", sha);
    const fetchImpl = async (url: string) =>
      url.endsWith("index.json")
        ? new Response(JSON.stringify(INDEX), { status: 200 })
        : new Response(buf, { status: 200 });
    const exec = async () => ({ code: 0, stdout: "", stderr: "" });

    await agentInstallAction("demo", {}, { fetchImpl: fetchImpl as any, exec });
    const envPath = join(profileDir("demo"), ".env");
    writeFileSync(envPath, "PROFILE_ID=demo\nAISA_API_KEY=sk-user-edited\n");
    await agentInstallAction("demo", {}, { fetchImpl: fetchImpl as any, exec });
    expect(readFileSync(envPath, "utf8")).toContain("sk-user-edited");
  });

  it("rejects non-hermes runtimes and unknown versions", async () => {
    await expect(agentInstallAction("demo", { runtime: "openclaw" }, {}))
      .rejects.toThrow(/hermes/);
  });
});
