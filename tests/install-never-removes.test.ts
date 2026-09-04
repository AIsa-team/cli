import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 🔴 This CLI must never remove a tool the user already has.
 *
 * It did. `installAgent` treated "the binary is on PATH but did not start" as
 * a broken install and repaired it with `npm uninstall -g` followed by a
 * reinstall. Two things made that destructive: `probeBinary` reports a
 * timeout exactly the same way it reports a broken install, so a slow start
 * on a loaded machine was enough to condemn a working tool — and when the
 * reinstall then failed on a flaky download, the uninstall had already
 * succeeded. Observed 2026-08-25 against a working `claude`, repeatedly:
 * install, works, gone.
 *
 * `npm install -g` installs over an existing copy on its own. There was never
 * a reason to remove first, and the failure mode of not removing is that the
 * user keeps what they had.
 *
 * This test reads the source rather than mocking a shell, because what is
 * being forbidden is the string itself: no argument about when it would be
 * safe is worth having.
 */

const src = (f: string) => readFileSync(join(import.meta.dirname, "..", "src", "commands", f), "utf-8");

describe("the installer never removes what the user has", () => {
  it.each(["install.ts", "connect.ts", "wrappers.ts", "llm-config.ts"])(
    "%s runs no uninstall",
    (file) => {
      const text = src(file);
      // Comments explaining why this is forbidden are the one allowed mention.
      const code = text
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(code).not.toMatch(/npm\s+uninstall/);
      expect(code).not.toMatch(/npm\s+rm\s+-g/);
      expect(code).not.toMatch(/rm\s+-rf\s+[^\s]*node_modules/);
    }
  );

  it("repairs a broken install by writing over it", () => {
    // The remedy for "installed but will not start" is the install command
    // again, not a removal followed by one.
    const text = src("install.ts");
    const repair = text.slice(text.indexOf("let probe = probeBinary"));
    expect(repair).toMatch(/runShell\(npmCommand \?\? command\)/);
  });
});
