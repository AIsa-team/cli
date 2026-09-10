import { afterEach, expect, it, vi } from "vitest";
import { signInAndStoreTokens } from "../src/commands/oauth-login.js";
import { replaceTokens } from "../src/config.js";

vi.mock("../src/config.js", async (original) => ({
  ...await original<typeof import("../src/config.js")>(), replaceTokens: vi.fn(),
}));
vi.mock("../src/utils/exec.js", () => ({ run: vi.fn(async () => ({})) }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("requests offline access and stores tokens with the original client ID without minting a key", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ client_id: "client" }))
    .mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
  vi.stubGlobal("fetch", fetch);
  const before = Date.now();
  expect(await signInAndStoreTokens({ catcher: { redirectUri: "http://127.0.0.1/callback", wait: async () => "code" } })).toBe("access");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "https://clerk.aisa.one/oauth/register", "https://clerk.aisa.one/oauth/token",
  ]);
  const registration = JSON.parse(fetch.mock.calls[0][1].body);
  expect(registration.grant_types).toContain("refresh_token");
  expect(registration.scope).toContain("offline_access");
  const [access, refresh, expiry, client] = vi.mocked(replaceTokens).mock.calls[0];
  expect([access, refresh, client]).toEqual(["access", "refresh", "client"]);
  expect(expiry).toBeGreaterThanOrEqual(before + 3600_000);
});

it.each([undefined, "", "   ", null, 123])("keeps the existing session when refresh_token is invalid: %s", async (refreshToken) => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ client_id: "client" }))
    .mockResolvedValueOnce(Response.json({ access_token: "access", refresh_token: refreshToken, expires_in: 3600 }));
  vi.stubGlobal("fetch", fetch);
  await expect(signInAndStoreTokens({ catcher: { redirectUri: "http://127.0.0.1/callback", wait: async () => "code" } }))
    .rejects.toThrow("Existing credentials were kept");
  expect(replaceTokens).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});
