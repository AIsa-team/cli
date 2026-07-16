import { mkdir, readFile, writeFile, readdir, rename, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";
import { parseManifest, type AgentManifest } from "@aisa-one/agent-spec";
import { stringify as yamlStringify } from "yaml";
import { expandHome } from "../utils/file.js";
import type { FetchLike } from "./index-client.js";

export interface InstalledMarker { id: string; version: string; target: "hermes"; pinned: boolean }

const MARKER = ".agentspec.json";

export function hermesRoot(): string {
  return expandHome(process.env.HERMES_HOME || "~/.hermes");
}

export function profileDir(id: string): string {
  return join(hermesRoot(), "profiles", id);
}

export async function downloadArtifact(
  url: string, sha256: string, fetchImpl: FetchLike = fetch,
): Promise<Buffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== sha256)
    throw new Error(`sha256 mismatch for ${url}\n  expected ${sha256}\n  actual   ${actual}`);
  return buf;
}

export async function extractBundle(buf: Buffer, destDir: string): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), "aisa-agent-"));
  const tarPath = join(tmp, "bundle.tar.gz");
  await writeFile(tarPath, buf);
  await mkdir(destDir, { recursive: true });
  await tar.x({ file: tarPath, cwd: destDir });
  // promote profile/ contents to the root (hermes profile layout)
  const profileSub = join(destDir, "profile");
  if (existsSync(profileSub)) {
    for (const name of await readdir(profileSub)) {
      await rm(join(destDir, name), { recursive: true, force: true });
      await rename(join(profileSub, name), join(destDir, name));
    }
    await rm(profileSub, { recursive: true, force: true });
  }
}

export async function readBundleManifest(destDir: string): Promise<AgentManifest> {
  const raw = JSON.parse(await readFile(join(destDir, "agent.json"), "utf8"));
  return parseManifest(yamlStringify(raw)); // 复用 schema 校验(YAML 是 JSON 超集)
}

export async function writeMarker(destDir: string, m: InstalledMarker): Promise<void> {
  await writeFile(join(destDir, MARKER), JSON.stringify(m, null, 2) + "\n");
}

export async function readMarker(dir: string): Promise<InstalledMarker | null> {
  try { return JSON.parse(await readFile(join(dir, MARKER), "utf8")); }
  catch { return null; }
}

export async function listInstalled(): Promise<{ dir: string; marker: InstalledMarker }[]> {
  const root = join(hermesRoot(), "profiles");
  if (!existsSync(root)) return [];
  const out: { dir: string; marker: InstalledMarker }[] = [];
  for (const name of await readdir(root)) {
    const dir = join(root, name);
    const marker = await readMarker(dir);
    if (marker) out.push({ dir, marker });
  }
  return out.sort((a, b) => a.marker.id.localeCompare(b.marker.id));
}
