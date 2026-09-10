import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, apiRequestRaw } from "../src/api.js";
import { routerPost } from "../src/router.js";
import { refreshAccessToken } from "../src/config.js";

vi.mock("../src/config.js", () => ({
  getConfig: () => "",
  refreshAccessToken: vi.fn(),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

const requests = {
  api: () => apiRequest("old", "test", { method: "POST", body: { x: 1 } }),
  raw: () => apiRequestRaw("old", "test", { method: "POST", body: { x: 1 } }),
  router: () => routerPost({ accessToken: "old", operation: "call", body: '{"x":1}' }),
};

describe.each(Object.entries(requests))("%s authentication retry", (_name, request) => {
  it("refreshes once and preserves request body and options", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    vi.mocked(refreshAccessToken).mockResolvedValue("new");
    await request();
    expect(refreshAccessToken).toHaveBeenCalledExactlyOnceWith("old");
    expect(fetch).toHaveBeenCalledTimes(2);
    const [firstUrl, first] = fetch.mock.calls[0];
    const [secondUrl, second] = fetch.mock.calls[1];
    expect(secondUrl).toBe(firstUrl);
    expect(second.body).toBe(first.body);
    expect(second.method).toBe(first.method);
    expect(second.redirect).toBe(first.redirect);
    expect(new Headers(second.headers).get("Authorization")).toBe("Bearer new");
  });

  it("returns the original 401 if refresh is unavailable or fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('"denied"', { status: 401 })));
    vi.mocked(refreshAccessToken).mockResolvedValue(undefined);
    const result = await request();
    expect(fetch).toHaveBeenCalledTimes(1);
    if ("status" in result) expect(result.status).toBe(401);
    else expect(result).toMatchObject({ success: false, error: expect.stringContaining("401") });
  });

  it("does not loop on a second 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('"denied"', { status: 401 })));
    vi.mocked(refreshAccessToken).mockResolvedValue("new");
    await request();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });
});

it("does not attach local credentials to anonymous Router requests", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
  await routerPost({ operation: "search", body: "{}" });
  expect(refreshAccessToken).not.toHaveBeenCalled();
});
