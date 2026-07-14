import { describe, it, expect } from "vitest";
import { agentListAction, agentInfoAction } from "../src/commands/agent.js";

const INDEX = {
  spec: "agent-index/v1",
  agents: {
    cio: {
      name: "Neo CIO", description: "AI CIO", repo: "AIsa-team/aisa_cio_agent",
      latest: "1.1.0",
      versions: { "1.1.0": { targets: { hermes: { url: "https://x/cio.tar.gz", sha256: "e".repeat(64) } } } },
    },
  },
};
const fakeFetch = async () => new Response(JSON.stringify(INDEX), { status: 200 });

describe("list/info", () => {
  it("list returns the index", async () => {
    const idx = await agentListAction({}, { fetchImpl: fakeFetch as any });
    expect(Object.keys(idx.agents)).toEqual(["cio"]);
  });

  it("info returns the entry and throws for unknown ids", async () => {
    const e = await agentInfoAction("cio", { fetchImpl: fakeFetch as any });
    expect(e.latest).toBe("1.1.0");
    await expect(agentInfoAction("nope", { fetchImpl: fakeFetch as any }))
      .rejects.toThrow(/unknown agent/);
  });
});
