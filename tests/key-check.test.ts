import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three answers, and why "cannot tell" is one of them.
 *
 * connect used to ask only whether a key existed. A key revoked from the
 * console looks exactly like a good one on disk, so the run skipped the
 * sign-in and wrote the dead key into every MCP entry — the user found out
 * when their agent failed to authenticate, long after the setup said it was
 * finished. But the opposite mistake is just as bad: telling someone on a
 * flaky connection that their key is dead and making them sign in again.
 */
let next: { ok: boolean; status: number } | Error;

vi.mock("../src/api.js", () => ({
  apiRequestRaw: async () => {
    if (next instanceof Error) throw next;
    return next;
  },
}));

async function verdict() {
  vi.resetModules();
  const { verifyKey } = await import("../src/utils/key-check.js");
  return verifyKey("sk-test");
}

describe("verifyKey", () => {
  beforeEach(() => {
    next = { ok: true, status: 200 };
  });

  it("accepts a key the gateway serves", async () => {
    expect(await verdict()).toBe("ok");
  });

  it("calls a rejected key invalid, so the run signs in again", async () => {
    next = { ok: false, status: 401 };
    expect(await verdict()).toBe("invalid");
    next = { ok: false, status: 403 };
    expect(await verdict()).toBe("invalid");
  });

  it("refuses to blame the key for a broken gateway", async () => {
    // 5xx has already been retried three times by httpFetch before it lands
    // here. Whatever is wrong, it is not the credential.
    next = { ok: false, status: 502 };
    expect(await verdict()).toBe("unreachable");
  });

  it("refuses to blame the key for a broken network", async () => {
    next = new Error("fetch failed");
    expect(await verdict()).toBe("unreachable");
  });

  it("treats no key at all as invalid", async () => {
    vi.resetModules();
    const { verifyKey } = await import("../src/utils/key-check.js");
    expect(await verifyKey(undefined)).toBe("invalid");
  });
});
