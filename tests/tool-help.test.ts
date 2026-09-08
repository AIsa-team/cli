import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { posixSingleQuote, shellInputFlag } from "../src/commands/tool-help.js";
import { validateEnvelope } from "../src/commands/tool-input.js";

describe("POSIX single-quote --input", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips apostrophe, Unicode, $(), and backticks as literal sh arguments", () => {
    const dir = mkdtempSync(join(tmpdir(), "aisa-posix-"));
    dirs.push(dir);
    const sentinel = join(dir, "executed");
    const input = {
      query: "company facts",
      known_fields: {
        name: "O'Reilly — 苹果",
        probe: `$(touch ${sentinel})\`touch ${sentinel}\``,
      },
    };
    validateEnvelope("search", input);
    const json = JSON.stringify(input);
    const flag = shellInputFlag(json);
    expect(flag.startsWith("--input '")).toBe(true);
    expect(posixSingleQuote("a'b")).toBe("'a'\\''b'");

    const out = execFileSync("/bin/sh", ["-c", `set -- ${flag}; printf %s "$2"`], {
      encoding: "utf8",
    });
    expect(out).toBe(json);
    expect(out).toContain("O'Reilly — 苹果");
    expect(out).toContain(`$(touch ${sentinel})`);
    expect(out).toContain(`\`touch ${sentinel}\``);
    expect(existsSync(sentinel)).toBe(false);
  });
});
