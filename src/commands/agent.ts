import chalk from "chalk";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { table, success, hint, truncate } from "../utils/display.js";
import { fetchIndex, requireAgent, siblingAssetUrl, type FetchLike } from "../agent/index-client.js";
import {
  hermesRoot, profileDir, downloadArtifact, extractBundle,
  readBundleManifest, writeMarker, listInstalled,
} from "../agent/installer.js";
import { collectEnv, type Prompt } from "../agent/env-setup.js";
import type { AgentIndex } from "@aisa-one/agent-spec";

export type Exec = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
const realExec: Exec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, (err, stdout, stderr) =>
    resolve({ code: err ? 1 : 0, stdout: String(stdout), stderr: String(stderr) }));
});

export async function agentListAction(
  _opts: Record<string, never>,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<AgentIndex> {
  const index = await fetchIndex(deps.fetchImpl);
  const rows = Object.entries(index.agents).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, e]) => [id, e.name, e.latest, truncate(e.description, 60)]);
  console.log(table(["ID", "NAME", "LATEST", "DESCRIPTION"], rows));
  hint(`install one with: aisa agent install <id>`);
  return index;
}

export async function agentInfoAction(
  id: string,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<AgentIndex["agents"][string]> {
  const index = await fetchIndex(deps.fetchImpl);
  const e = requireAgent(index, id);
  console.log(`${chalk.bold(e.name)} (${id})`);
  console.log(`  ${e.description}`);
  console.log(`  repo:   https://github.com/${e.repo}`);
  console.log(`  latest: ${e.latest}`);
  for (const [v, spec] of Object.entries(e.versions))
    console.log(`  ${v}: targets ${Object.keys(spec.targets).join(", ")}`);
  hint(`install with: aisa agent install ${id}`);
  return e;
}

export async function agentInstallAction(
  id: string,
  opts: { version?: string; runtime?: string },
  deps: { fetchImpl?: FetchLike; prompt?: Prompt; exec?: Exec } = {},
): Promise<void> {
  const runtime = opts.runtime ?? "hermes";
  if (runtime !== "hermes")
    throw new Error(`runtime "${runtime}" not supported yet — v1 supports: hermes`);
  if (!existsSync(hermesRoot()))
    throw new Error(
      `hermes not found at ${hermesRoot()} — install it first:\n` +
      `  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`);

  const index = await fetchIndex(deps.fetchImpl);
  const entry = requireAgent(index, id);
  const version = opts.version ?? entry.latest;
  const versionSpec = entry.versions[version];
  if (!versionSpec) throw new Error(
    `version ${version} not found for ${id} — available: ${Object.keys(entry.versions).join(", ")}`);
  const artifact = versionSpec.targets[runtime];
  if (!artifact) throw new Error(`no ${runtime} artifact for ${id}@${version}`);

  const dir = profileDir(id);
  const existingEnv = existsSync(join(dir, ".env"))
    ? await readFile(join(dir, ".env"), "utf8") : null;

  const buf = await downloadArtifact(artifact.url, artifact.sha256, deps.fetchImpl);
  await extractBundle(buf, dir);

  const manifest = await readBundleManifest(dir);
  const envText = await collectEnv(manifest, existingEnv, { prompt: deps.prompt });
  await writeFile(join(dir, ".env"), envText);

  const exec = deps.exec ?? realExec;
  const r = await exec("bash", [join(dir, "scripts", "render.sh"), dir]);
  if (r.code !== 0) throw new Error(`render failed: ${r.stderr}`);

  await writeMarker(dir, {
    id, version, target: "hermes",
    pinned: !!opts.version || manifest.update.channel === "pinned",
  });
  success(`installed ${entry.name} ${version} -> ${dir}`);
  hint(`start it with: hermes --profile ${id}`);
}
export async function agentUpdateAction(
  id: string | undefined,
  _opts: Record<string, never>,
  deps: { fetchImpl?: FetchLike; prompt?: Prompt; exec?: Exec } = {},
): Promise<{ id: string; from: string; to: string; status: "updated" | "up-to-date" | "pinned" }[]> {
  const installed = await listInstalled();
  const targets = id ? installed.filter((i) => i.marker.id === id) : installed;
  if (id && targets.length === 0)
    throw new Error(`agent "${id}" is not installed (no .agentspec.json marker found)`);
  if (targets.length === 0) { hint("no installed agents found"); return []; }

  const index = await fetchIndex(deps.fetchImpl);
  const results: { id: string; from: string; to: string; status: "updated" | "up-to-date" | "pinned" }[] = [];

  for (const { marker } of targets) {
    if (marker.pinned) {
      console.log(`${marker.id}: pinned at ${marker.version} — skipping`);
      results.push({ id: marker.id, from: marker.version, to: marker.version, status: "pinned" });
      continue;
    }
    const entry = index.agents[marker.id];
    if (!entry || entry.latest === marker.version) {
      results.push({ id: marker.id, from: marker.version, to: marker.version, status: "up-to-date" });
      continue;
    }
    await agentInstallAction(marker.id, {}, deps);   // install 已保留 .env、更新 marker
    results.push({ id: marker.id, from: marker.version, to: entry.latest, status: "updated" });
  }

  for (const r of results)
    if (r.status === "updated") success(`${r.id}: ${r.from} -> ${r.to}`);
  return results;
}
export async function agentGuideAction(_id: string, _opts: { md?: boolean }): Promise<void> {
  throw new Error("not implemented");
}
