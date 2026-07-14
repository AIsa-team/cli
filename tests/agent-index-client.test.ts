import { describe, it, expect, afterEach } from "vitest";
import { fetchIndex, requireAgent, siblingAssetUrl, indexUrl } from "../src/agent/index-client.js";

const INDEX = {
  spec: "agent-index/v1",
  agents: {
    cio: {
      name: "Neo CIO", description: "AI CIO", repo: "AIsa-team/aisa_cio_agent",
      latest: "1.1.0",
      versions: { "1.1.0": { targets: { hermes: {
        url: "https://github.com/AIsa-team/aisa_cio_agent/releases/download/v1.1.0/cio-hermes-v1.1.0.tar.gz",
        sha256: "e".repeat(64),
      } } } },
    },
  },
};

afterEach(() => { delete process.env.AISA_AGENT_INDEX_URL; });

describe("index client", () => {
  it("fetches and validates the index from the (env-overridable) url", async () => {
    process.env.AISA_AGENT_INDEX_URL = "https://test.local/index.json";
    expect(indexUrl()).toBe("https://test.local/index.json");
    const fakeFetch = async (url: string) => {
      expect(url).toBe("https://test.local/index.json");
      return new Response(JSON.stringify(INDEX), { status: 200 });
    };
    const idx = await fetchIndex(fakeFetch as any);
    expect(idx.agents.cio.latest).toBe("1.1.0");
  });

  it("rejects an invalid index and a failed fetch", async () => {
    await expect(fetchIndex(async () => new Response("{}", { status: 200 })))
      .rejects.toThrow();
    await expect(fetchIndex(async () => new Response("x", { status: 500 })))
      .rejects.toThrow(/500/);
  });

  it("requireAgent errors with available ids", () => {
    expect(() => requireAgent(INDEX as any, "nope")).toThrow(/nope.*cio/s);
  });

  it("siblingAssetUrl swaps the last path segment", () => {
    expect(siblingAssetUrl(INDEX.agents.cio.versions["1.1.0"].targets.hermes.url, "INSTALL.md"))
      .toBe("https://github.com/AIsa-team/aisa_cio_agent/releases/download/v1.1.0/INSTALL.md");
  });
});
