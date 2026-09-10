import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;

vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

// conf resolves its own storage path via env-paths at import time; point it
// into the sandbox so tests never touch the real store. The stub also records
// the constructor options, so the file-mode contract can be asserted without
// reaching for the real store's platform-specific path.
let confStore: Record<string, unknown> = {};
let confOptions: Record<string, unknown> = {};
let confPath = "";
vi.mock("conf", () => ({
  default: class {
    path: string;
    constructor(options: Record<string, unknown>) {
      confOptions = options;
      this.path = confPath;
    }
    get(k: string) {
      return confStore[k] ?? "";
    }
    set(k: string, v: unknown) {
      confStore[k] = v;
    }
    delete(k: string) {
      delete confStore[k];
    }
  },
}));

const { getAccessToken, storeTokens, clearTokens, refreshAccessToken, getKeySource, revokeAndClearTokens, replaceTokens } = await import("../src/config.js");

const keyPath = () => join(home, ".aisa", "key");
const tokenPath = () => join(home, ".aisa", "tokens.json");
const saved = () => JSON.parse(readFileSync(tokenPath(), "utf-8"));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-key-"));
  confStore = {};
  delete process.env.AISA_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

describe("token storage and refresh", () => {
  it("stores tokens with 0600 and write-only legacy mirrors", async () => {
    await storeTokens("access", "refresh", 123, "client");
    expect(saved()).toEqual({ accessToken: "access", refreshToken: "refresh", expiresAt: 123, clientId: "client" });
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600);
    expect(confStore.apiKey).toBe("access");
    expect(confStore.tokens).toEqual(saved());
    expect(getKeySource()).toBe("config");
  });

  it("env overrides expired OAuth tokens and never refreshes", async () => {
    await storeTokens("access", "refresh", 0, "client");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    process.env.AISA_API_KEY = "env-token";
    expect(await getAccessToken()).toBe("env-token");
    expect(await refreshAccessToken()).toBeUndefined();
    expect(getKeySource()).toBe("env");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("migrates the legacy file, never conf.apiKey", async () => {
    confStore.apiKey = "ignored";
    expect(await getAccessToken()).toBeUndefined();
    expect(getKeySource()).toBe("none");
    mkdirSync(join(home, ".aisa"), { recursive: true });
    writeFileSync(keyPath(), "sk-legacy\n");
    expect(await getAccessToken()).toBe("sk-legacy");
    expect(saved()).toEqual({ accessToken: "sk-legacy" });
  });

  it("prefers tokens.json and clears all credential stores", async () => {
    await storeTokens("access");
    writeFileSync(keyPath(), "sk-stale");
    expect(await getAccessToken()).toBe("access");
    await clearTokens();
    expect(existsSync(tokenPath())).toBe(false);
    expect(existsSync(keyPath())).toBe(false);
    expect(confStore.apiKey).toBeUndefined();
    expect(confStore.tokens).toBeUndefined();
    expect(await getAccessToken()).toBeUndefined();
  });

  it("static login replaces OAuth metadata and never refreshes", async () => {
    await storeTokens("access", "refresh", 0, "client");
    await storeTokens("static-key");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(saved()).toEqual({ accessToken: "static-key" });
    expect(await getAccessToken()).toBe("static-key");
    expect(await refreshAccessToken()).toBeUndefined();
    await storeTokens("sk-static", "refresh", 0, "client");
    expect(await refreshAccessToken()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes near expiry once for concurrent readers and rotates tokens", async () => {
    await storeTokens("old", "refresh", Date.now() + 30_000, "client");
    const fetch = vi.fn(async () => Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetch);
    expect(await Promise.all([getAccessToken(), getAccessToken(), refreshAccessToken("old")])).toEqual(["new", "new", "new"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://clerk.aisa.one/oauth/token");
    expect(new URLSearchParams(options.body as URLSearchParams).get("client_id")).toBe("client");
    expect(new URLSearchParams(options.body as URLSearchParams).get("refresh_token")).toBe("refresh");
    expect(new URLSearchParams(options.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
    expect(saved().refreshToken).toBe("rotated");
    expect(saved().expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(await getAccessToken()).toBe("new");
    expect(await refreshAccessToken("old")).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves refresh token when omitted and rejects unrelated credentials", async () => {
    await storeTokens("old", "refresh", undefined, "client");
    const fetch = vi.fn(async () => Response.json({ access_token: "new" }));
    vi.stubGlobal("fetch", fetch);
    expect(await refreshAccessToken("unrelated")).toBeUndefined();
    expect(await refreshAccessToken("old")).toBe("new");
    expect(saved().refreshToken).toBe("refresh");
  });

  it.each(["http", "network", "malformed"])("preserves credentials on %s refresh failure", async (kind) => {
    await storeTokens("old", "refresh", 0, "client");
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (kind === "network") throw new Error("offline");
      return kind === "http" ? new Response("invalid_grant", { status: 400 }) : Response.json({});
    }));
    expect(await getAccessToken()).toBe("old");
    expect(saved().refreshToken).toBe("refresh");
  });


});

/**
 * The legacy conf store mirrors the key so a published CLI up to 0.3.0 —
 * which reads only from there — keeps working beside a newer copy. That
 * mirror shipped world-readable (conf defaults to 0o666) until 2026-08-24,
 * exposing both the API key and the Twitter session cookies on shared
 * machines. Both halves of the fix are pinned here.
 */
describe("legacy conf store permissions", () => {
  it("is constructed to write 0600, not conf's 0o666 default", () => {
    expect(confOptions.configFileMode).toBe(0o600);
  });

  it("tightens a store that already exists at 0644", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aisa-conf-"));
    confPath = join(dir, "config.json");
    writeFileSync(confPath, "{}", { mode: 0o644 });
    expect(statSync(confPath).mode & 0o777).toBe(0o644);

    // The chmod runs at module load, so re-import with the path in place.
    vi.resetModules();
    await import("../src/config.js");

    expect(statSync(confPath).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
    confPath = "";
  });
});


describe("OAuth logout", () => {
  it("revokes the stored refresh token before clearing every mirror, even with an env override", async () => {
    await storeTokens("access", "refresh", 0, "client");
    process.env.AISA_API_KEY = "sk-env";
    const fetch = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe("https://clerk.aisa.one/oauth/token/revoke");
      expect(saved().refreshToken).toBe("refresh");
      expect(Object.fromEntries(options.body as URLSearchParams)).toEqual({ token: "refresh", token_type_hint: "refresh_token", client_id: "client" });
      expect(options.redirect).toBe("error");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    expect((await Promise.all([revokeAndClearTokens(), revokeAndClearTokens()])).sort()).toEqual([false, true]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(existsSync(tokenPath())).toBe(false);
    expect(existsSync(keyPath())).toBe(false);
    expect(confStore.apiKey).toBeUndefined();
    expect(confStore.tokens).toBeUndefined();
    expect(await getAccessToken()).toBe("sk-env");
  });

  it.each(["http", "network"])("retains credentials after %s failure for a retry", async (kind) => {
    await storeTokens("access", "refresh", 0, "client");
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (kind === "network") throw new Error("network secret");
      return new Response("upstream secret", { status: 500 });
    }));
    await expect(revokeAndClearTokens()).rejects.toThrow("Credentials retained");
    expect(saved().refreshToken).toBe("refresh");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    expect(await revokeAndClearTokens()).toBe(true);
  });

  it("only clears static keys locally", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await storeTokens("sk-static");
    expect(await revokeAndClearTokens()).toBe(false);
    expect(await revokeAndClearTokens()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("waits for in-flight rotation and revokes the newly issued refresh token", async () => {
    await storeTokens("old", "refresh", 0, "client");
    let finish!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }))
      .mockImplementationOnce(async (_url: string, options: RequestInit) => {
        expect((options.body as URLSearchParams).get("token")).toBe("rotated");
        return new Response(null, { status: 200 });
      });
    vi.stubGlobal("fetch", fetch);
    const refreshing = refreshAccessToken();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const logout = revokeAndClearTokens();
    finish(Response.json({ access_token: "new", refresh_token: "rotated" }));
    await refreshing;
    expect(await logout).toBe(true);
    expect(existsSync(tokenPath())).toBe(false);
  });

});


describe("login replacement", () => {
  it.each(["oauth", "static"])("revokes the old grant when replacing with %s", async (kind) => {
    await storeTokens("old", "old-refresh", 0, "old-client");
    const fetch = vi.fn(async (_url: string, options: RequestInit) => {
      expect(saved().accessToken).toBe("old");
      expect((options.body as URLSearchParams).get("token")).toBe("old-refresh");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    if (kind === "oauth") await replaceTokens("new", "new-refresh", Date.now() + 3600000, "new-client");
    else await replaceTokens("sk-new");
    expect(saved().accessToken).toBe(kind === "oauth" ? "new" : "sk-new");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, ".aisa", ".pending-tokens.json"))).toBe(false);
  });

  it("retains both grants after failed revocation and cleans them on logout", async () => {
    await storeTokens("old", "old-refresh", 0, "old-client");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("failed", { status: 500 })));
    await expect(replaceTokens("new", "new-refresh", 0, "new-client")).rejects.toThrow("Credentials retained");
    expect(saved().accessToken).toBe("old");
    const pending = join(home, ".aisa", ".pending-tokens.json");
    expect(JSON.parse(readFileSync(pending, "utf8"))[0].refreshToken).toBe("new-refresh");
    expect(statSync(pending).mode & 0o777).toBe(0o600);
    const revoked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      revoked.push((options.body as URLSearchParams).get("token")!);
      return new Response(null, { status: 200 });
    }));
    expect(await revokeAndClearTokens()).toBe(true);
    expect(revoked).toEqual(["new-refresh", "old-refresh"]);
    expect(existsSync(pending)).toBe(false);
    expect(existsSync(tokenPath())).toBe(false);
  });
});


it("retains every incoming grant when replacement cleanup repeatedly fails", async () => {
  await storeTokens("old", "old-refresh", 0, "old-client");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
  await expect(replaceTokens("first", "first-refresh", 0, "first-client")).rejects.toThrow();
  await expect(replaceTokens("second", "second-refresh", 0, "second-client")).rejects.toThrow();
  const pending = JSON.parse(readFileSync(join(home, ".aisa/.pending-tokens.json"), "utf8"));
  expect(pending.map((entry: { refreshToken: string }) => entry.refreshToken)).toEqual(["first-refresh", "second-refresh"]);
  expect(saved().accessToken).toBe("old");
});


describe("credential persistence failures", () => {
  it("preserves newly issued grants when acquiring the credential lock fails", async () => {
    await storeTokens("old", "old-refresh", 0, "old-client");
    const lock = vi.spyOn(lockfile, "lock").mockRejectedValue(new Error("lock timeout"));
    await expect(replaceTokens("new", "new-refresh", 0, "new-client")).rejects.toThrow("lock timeout");
    const recovery = readdirSync(join(home, ".aisa")).filter((name) => name.startsWith(".pending-login-"));
    expect(recovery).toHaveLength(1);
    const recoveryPath = join(home, ".aisa", recovery[0]);
    expect(JSON.parse(readFileSync(recoveryPath, "utf8")).refreshToken).toBe("new-refresh");
    expect(statSync(recoveryPath).mode & 0o777).toBe(0o600);
    expect(saved().refreshToken).toBe("old-refresh");
    lock.mockRestore();
    const revoked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      revoked.push((options.body as URLSearchParams).get("token")!);
      return new Response(null, { status: 200 });
    }));
    await revokeAndClearTokens();
    expect(revoked).toEqual(["new-refresh", "old-refresh"]);
    expect(existsSync(recoveryPath)).toBe(false);
  });

  it("keeps rotated credentials when the auxiliary rotation file is unwritable", async () => {
    await storeTokens("old", "old-refresh", 0, "client");
    mkdirSync(join(home, ".aisa/.token-rotation.json"));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600 })));
    expect(await getAccessToken()).toBe("new");
    expect(saved().refreshToken).toBe("new-refresh");
    expect(await getAccessToken()).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports primary credential persistence failure instead of returning the old token", async () => {
    await storeTokens("old", "old-refresh", 0, "client");
    vi.stubGlobal("fetch", vi.fn(async () => {
      rmSync(tokenPath());
      mkdirSync(tokenPath());
      return Response.json({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600 });
    }));
    await expect(getAccessToken()).rejects.toThrow("new credentials could not be saved");
  });
});
