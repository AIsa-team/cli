import { describe, expect, it } from "vitest";
import { pickNpmChannel } from "../src/commands/install.js";

/**
 * The channel decision is pure logic once the probe and the user's npm
 * config are injected, so these tests cover the decision table without a
 * network. What matters most: the mirror is only ever a fallback, and a
 * user who already picked a registry is never overridden.
 */

const PKG = "@anthropic-ai/claude-code";
const probeWhere = (reachable: RegExp) => async (url: string) => reachable.test(url);

describe("pickNpmChannel", () => {
  it("leaves a user-configured registry alone, probing nothing", async () => {
    let probed = 0;
    const ch = await pickNpmChannel(
      PKG,
      async () => {
        probed++;
        return true;
      },
      () => "https://registry.npmmirror.com/"
    );
    expect(ch).toEqual({ kind: "user" });
    expect(probed).toBe(0);
  });

  it("prefers the official registry whenever it answers", async () => {
    const ch = await pickNpmChannel(PKG, probeWhere(/npmjs|npmmirror/), () => null);
    expect(ch).toEqual({ kind: "official" });
  });

  it("falls back to the mirror only when official is unreachable", async () => {
    const ch = await pickNpmChannel(PKG, probeWhere(/npmmirror/), () => null);
    expect(ch).toEqual({ kind: "mirror", registry: "https://registry.npmmirror.com" });
  });

  it("reports offline when nothing answers", async () => {
    const ch = await pickNpmChannel(PKG, async () => false, () => null);
    expect(ch).toEqual({ kind: "offline" });
  });

  it("probes for the exact package, scope escaped", async () => {
    const urls: string[] = [];
    await pickNpmChannel(
      PKG,
      async (u) => {
        urls.push(u);
        return false;
      },
      () => "https://registry.npmjs.org/"
    );
    expect(urls[0]).toBe("https://registry.npmjs.org/@anthropic-ai%2fclaude-code");
  });
});
