import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentManifest } from "@aisa-one/agent-spec";

export type Exec = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const SKIP_OPTIONAL_ENV = "AGENT_SKIP_OPTIONAL_SETUP";

async function upsertEnvLine(dir: string, key: string, value: string): Promise<void> {
  const envPath = join(dir, ".env");
  const text = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const lines = text.split("\n").filter((l) => !l.startsWith(`${key}=`));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(`${key}=${value}`);
  await writeFile(envPath, lines.join("\n") + "\n");
}

export interface SetupResult { name: string; status: "ok" | "skipped" | "failed" }

/** Build the venvs declared in manifest.setup.python and point their env vars
 *  at the venv interpreters (written into <profileDir>/.env). */
export async function runPythonSetup(
  manifest: AgentManifest,
  profileDir: string,
  exec: Exec,
): Promise<SetupResult[]> {
  const skipOptional = process.env[SKIP_OPTIONAL_ENV] === "1";
  const results: SetupResult[] = [];

  for (const s of manifest.setup.python) {
    if (s.optional && skipOptional) {
      console.log(`setup ${s.name}: optional, skipped (${SKIP_OPTIONAL_ENV}=1)`);
      results.push({ name: s.name, status: "skipped" });
      continue;
    }
    const venvDir = join(profileDir, ".venvs", s.name);
    const venvPython = join(venvDir, "bin", "python");
    const reqPath = join(profileDir, s.requirements);
    console.log(`setup ${s.name}: building venv (${s.requirements})…`);

    const created = await exec("python3", ["-m", "venv", venvDir]);
    const installed = created.code === 0
      ? await exec(venvPython, ["-m", "pip", "install", "-r", reqPath])
      : created;

    if (installed.code !== 0) {
      const detail = installed.stderr.slice(-500);
      if (!s.optional)
        throw new Error(`setup ${s.name} failed (required):\n${detail}`);
      console.log(`setup ${s.name}: failed, degrading (optional). ${s.description ?? ""}`);
      results.push({ name: s.name, status: "failed" });
      continue;
    }
    await upsertEnvLine(profileDir, s.env, venvPython);
    console.log(`setup ${s.name}: ok -> ${s.env}=${venvPython}`);
    results.push({ name: s.name, status: "ok" });
  }
  return results;
}
