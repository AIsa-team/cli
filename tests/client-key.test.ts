import { afterEach, expect, it, vi } from "vitest";
import { clientConfigKey } from "../src/utils/client-key.js";

afterEach(() => { vi.unstubAllGlobals(); });

it("passes a static key through without calling the server", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await clientConfigKey("sk-static")).toBe("sk-static");
  expect(fetch).not.toHaveBeenCalled();
});

it("trades an OAuth access token for the durable cli key", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ key: "sk-minted" }));
  vi.stubGlobal("fetch", fetch);
  expect(await clientConfigKey("oauth-access")).toBe("sk-minted");
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("https://api.aisa.one/v1/keys/mint");
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer oauth-access");
  expect(JSON.parse(init.body)).toEqual({ client: "cli" });
});

it("never falls back to the access token when minting fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 })));
  await expect(clientConfigKey("oauth-access")).rejects.toThrow("unauthorized");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })));
  await expect(clientConfigKey("oauth-access")).rejects.toThrow("aisa login --key");
});
