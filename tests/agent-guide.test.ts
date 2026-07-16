import { describe, it, expect } from "vitest";
import { agentGuideAction } from "../src/commands/agent.js";
import { indexFor } from "./helpers/agent-fixtures.js";

const INDEX = indexFor("demo", "1.0.0", "e".repeat(64));

describe("guide", () => {
  const fetchImpl = async (url: string) => {
    if (url.endsWith("index.json")) return new Response(JSON.stringify(INDEX), { status: 200 });
    if (url.endsWith("guide-prompt.txt")) return new Response("PASTE ME", { status: 200 });
    if (url.endsWith("INSTALL.md")) return new Response("# Install Demo", { status: 200 });
    return new Response("nf", { status: 404 });
  };

  it("prints the guide prompt by default and INSTALL.md with --md", async () => {
    expect(await agentGuideAction("demo", {}, { fetchImpl: fetchImpl as any })).toBe("PASTE ME");
    expect(await agentGuideAction("demo", { md: true }, { fetchImpl: fetchImpl as any }))
      .toBe("# Install Demo");
  });

  it("errors clearly when the asset is missing", async () => {
    const noAsset = async (url: string) =>
      url.endsWith("index.json")
        ? new Response(JSON.stringify(INDEX), { status: 200 })
        : new Response("nf", { status: 404 });
    await expect(agentGuideAction("demo", {}, { fetchImpl: noAsset as any }))
      .rejects.toThrow(/guide-prompt.txt/);
  });
});

describe("guide prefers index asset urls (2026-07-15 schema)", () => {
  it("fetches the url carried by the index when present", async () => {
    const idx = indexFor("demo", "1.0.0", "e".repeat(64)) as any;
    idx.agents.demo.versions["1.0.0"].targets.hermes.guidePrompt = "https://x/guide-prompt-hermes.txt";
    idx.agents.demo.versions["1.0.0"].targets.hermes.installMd = "https://x/INSTALL-hermes.md";
    const fetchImpl = async (url: string) => {
      if (url.endsWith("index.json")) return new Response(JSON.stringify(idx), { status: 200 });
      if (url === "https://x/guide-prompt-hermes.txt") return new Response("SUFFIXED", { status: 200 });
      if (url === "https://x/INSTALL-hermes.md") return new Response("# Suffixed Install", { status: 200 });
      return new Response("nf", { status: 404 });
    };
    expect(await agentGuideAction("demo", {}, { fetchImpl: fetchImpl as any })).toBe("SUFFIXED");
    expect(await agentGuideAction("demo", { md: true }, { fetchImpl: fetchImpl as any })).toBe("# Suffixed Install");
  });
});
