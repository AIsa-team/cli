import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { homedir } from "node:os";

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export function writeSkillFiles(
  targetDir: string,
  files: Array<{ path: string; content: string }>
): void {
  for (const file of files) {
    const safePath = sanitizePath(file.path);
    const fullPath = join(targetDir, safePath);
    ensureDir(join(fullPath, ".."));
    writeFileSync(fullPath, file.content, "utf-8");
  }
}

export function removeDir(dirPath: string): void {
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
  }
}

function sanitizePath(filePath: string): string {
  const resolved = resolve("/", filePath);
  const rel = relative("/", resolved);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  return rel;
}

export function detectAgents(agentDirs: Record<string, string>): string[] {
  const detected: string[] = [];
  for (const [name, dir] of Object.entries(agentDirs)) {
    const parent = expandHome(dir).replace(/\/skills\/?$/, "");
    if (existsSync(parent)) {
      detected.push(name);
    }
  }
  return detected;
}
