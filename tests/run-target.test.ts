import { describe, expect, it } from "vitest";
import { resolveRunTarget } from "../src/commands/run.js";
import { LLM_ROUTE_PREFIXES } from "../src/constants.js";

/**
 * `run` previously kept a hardcoded whitelist of integration slugs and sent
 * everything else to the LLM gateway, which 404'd 23 of the 29 providers. The
 * whitelist now sits on the LLM side; these cases pin that inversion down.
 */
describe("resolveRunTarget", () => {
  it("routes integration providers to the domain base", () => {
    expect(resolveRunTarget("financial", "/news")).toEqual({
      base: "domain",
      endpoint: "financial/news",
    });
    expect(resolveRunTarget("coingecko", "simple/price").base).toBe("domain");
    expect(resolveRunTarget("brave", "/web/search").base).toBe("domain");
    expect(resolveRunTarget("tavily", "/search").base).toBe("domain");
  });

  it("routes unknown providers to the domain base so new APIs work without a release", () => {
    expect(resolveRunTarget("some-provider-added-tomorrow", "/thing").base).toBe("domain");
  });

  it("routes LLM gateway paths to the LLM base", () => {
    expect(resolveRunTarget("chat", "completions")).toEqual({
      base: "llm",
      endpoint: "chat/completions",
    });
    expect(resolveRunTarget("models", "").base).toBe("llm");
    expect(resolveRunTarget("credits", "/balance").base).toBe("llm");
    expect(resolveRunTarget("video", "/generations").base).toBe("llm");
  });

  /**
   * Every first path segment the gateway serves outside /apis/v1, transcribed
   * from services/api-service/internal/httpapi/server.go#registerRoutes. The
   * whitelist is maintained by hand, so a route added server-side is invisible
   * here until someone checks — `classify` was missed exactly that way and got
   * misrouted to /apis/v1/classify.
   */
  it("covers every LLM gateway route the server registers", () => {
    const serverRoutes = [
      "chat", // POST /v1/chat/completions
      "responses", // POST /v1/responses
      "embeddings", // POST /v1/embeddings
      "messages", // POST /v1/messages
      "models", // GET  /v1/models, /v1/models/:model
      "rerank", // POST /v1/rerank (and the /rerank alias)
      "classify", // POST /v1/classify
      "images", // POST /v1/images/generations, /v1/images/edits
      "credits", // GET  /v1/credits/balance
      "video", // POST /v1/video/generations
      "v1beta", // POST /v1beta/models/*path
    ];
    const missing = serverRoutes.filter((r) => !LLM_ROUTE_PREFIXES.includes(r));
    expect(missing).toEqual([]);
  });

  it("honours explicit overrides", () => {
    expect(resolveRunTarget("financial", "/news", { llm: true }).base).toBe("llm");
    expect(resolveRunTarget("chat", "/completions", { domain: true }).base).toBe("domain");
  });

  it("normalises slashes", () => {
    expect(resolveRunTarget("/financial/", "///news").endpoint).toBe("financial/news");
    expect(resolveRunTarget("financial", "").endpoint).toBe("financial");
  });

  it("keeps the LLM prefixes disjoint from known provider ids", () => {
    // Not an invariant the server enforces — if operations ever registers a
    // provider named e.g. `models`, `run` would silently misroute it.
    const knownProviders = [
      "agentmail", "aisa-twitter", "apollo", "brave-answer", "brave-search",
      "coingecko", "composio", "dataforseo", "edinet", "exa", "financial",
      "fred", "jina", "kalshi-unauthorized", "parallel.ai", "perplexity",
      "polymarket-bridge", "polymarket-clob", "polymarket-data",
      "polymarket-gamma", "polymarket-relayer", "querit", "scholar",
      "scrape-creators", "search", "tavily", "twitter", "waveinflu", "youtube",
    ];
    const overlap = knownProviders.filter((p) => LLM_ROUTE_PREFIXES.includes(p));
    expect(overlap).toEqual([]);
  });
});
