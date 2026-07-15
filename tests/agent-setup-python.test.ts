import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@aisa-one/agent-spec";
import { runPythonSetup } from "../src/agent/setup-python.js";

const manifest = parseManifest(`
spec: agentspec/v1
id: demo
name: Demo
version: 0.1.0
description: d
setup:
  python:
    - { name: dsa, requirements: requirements/dsa.txt, env: DSA_VENV_PYTHON, optional: true }
    - { name: core, requirements: requirements/core.txt, env: CORE_PY }
`);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aisa-setup-"));
  writeFileSync(join(dir, ".env"), "PROFILE_ID=demo\n");
});
afterEach(() => { delete process.env.AGENT_SKIP_OPTIONAL_SETUP; });

function okExec() {
  const calls: string[][] = [];
  const exec = async (cmd: string, args: string[]) =>
    (calls.push([cmd, ...args]), { code: 0, stdout: "", stderr: "" });
  return { exec, calls };
}

describe("runPythonSetup", () => {
  it("creates venvs, installs requirements, writes env vars into .env", async () => {
    const { exec, calls } = okExec();
    const results = await runPythonSetup(manifest, dir, exec);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(calls[0]).toEqual(["python3", "-m", "venv", join(dir, ".venvs", "dsa")]);
    expect(calls[1][0]).toBe(join(dir, ".venvs", "dsa", "bin", "python"));
    expect(calls[1]).toContain(join(dir, "requirements/dsa.txt"));
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain(`DSA_VENV_PYTHON=${join(dir, ".venvs", "dsa", "bin", "python")}`);
    expect(env).toContain("CORE_PY=");
    expect(env).toContain("PROFILE_ID=demo");
  });

  it("optional failure degrades, required failure throws", async () => {
    const failExec = async (cmd: string) =>
      ({ code: cmd === "python3" ? 0 : 1, stdout: "", stderr: "boom" });
    await expect(runPythonSetup(manifest, dir, failExec)).rejects.toThrow(/core.*required|required/s);
    const optOnly = { ...manifest, setup: { python: [manifest.setup.python[0]] } };
    const results = await runPythonSetup(optOnly, dir, failExec);
    expect(results[0].status).toBe("failed");
    expect(readFileSync(join(dir, ".env"), "utf8")).not.toContain("DSA_VENV_PYTHON");
  });

  it("AGENT_SKIP_OPTIONAL_SETUP=1 skips optional venvs only", async () => {
    process.env.AGENT_SKIP_OPTIONAL_SETUP = "1";
    const { exec, calls } = okExec();
    const results = await runPythonSetup(manifest, dir, exec);
    expect(results).toEqual([
      { name: "dsa", status: "skipped" },
      { name: "core", status: "ok" },
    ]);
    expect(calls.some((c) => c.join(" ").includes(".venvs/dsa"))).toBe(false);
  });
});
