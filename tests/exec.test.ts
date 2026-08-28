import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { run, runShell, runSync, MAX_OUTPUT_BYTES } from "../src/utils/exec.js";

/**
 * A 1 MB default buffer once killed a finished `npm install -g` and made the
 * run look hung. These pin both halves of the fix: the helpers carry a large
 * buffer, and no command file goes around them.
 */

describe("exec helpers", () => {
  it("survives output far past Node's 1 MB default", async () => {
    const big = 4 * 1024 * 1024;
    const r = await runShell(`head -c ${big} /dev/zero | tr '\\0' 'x'`);
    expect(r.ok).toBe(true);
    expect(r.stdout.length).toBe(big);
  });

  it("reports a failing command without throwing", async () => {
    const r = await runShell("exit 3");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/exit|Command failed/i);
  });

  it("run rejects on a non-zero exit and runSync reports status", async () => {
    await expect(run("/bin/sh", ["-c", "exit 4"])).rejects.toThrow();
    expect(runSync("/bin/sh", ["-c", "exit 5"]).status).toBe(5);
    expect(runSync("/bin/echo", ["hi"]).stdout.trim()).toBe("hi");
  });

  it("buffers are large enough to be worth having", () => {
    expect(MAX_OUTPUT_BYTES).toBeGreaterThanOrEqual(16 * 1024 * 1024);
  });

  it("no command file spawns children outside these helpers", () => {
    const dir = join(import.meta.dirname, "..", "src", "commands");
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf-8");
      // `spawn` (streaming, no buffer to overflow) stays allowed: agent
      // OAuth flows need inherited stdio.
      if (/\b(execFile|execFileSync|spawnSync)\s*\(/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
