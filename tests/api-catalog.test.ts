import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderDetail, getProviders, type CatalogDetail } from "../src/catalog.js";
import { apiListAction, apiShowAction } from "../src/commands/api.js";

vi.mock("../src/catalog.js", async (original) => ({
  ...await original<typeof import("../src/catalog.js")>(),
  getProviders: vi.fn(),
  getProviderDetail: vi.fn(),
}));

function provider(type: string, normal: number): CatalogDetail {
  return {
    id: "financial",
    endpoint_count: 1,
    is_active: true,
    pricing: { type, normal },
    endpoint_groups: [{
      name: "default",
      endpoints: [{
        method: "GET",
        path: "/apis/v1/financial/news",
        pricing: { type, normal },
      }],
    }],
  };
}

describe("API catalog pricing", () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      output.push(String(line ?? ""));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function stubCatalog(detail: CatalogDetail): void {
    vi.mocked(getProviders).mockResolvedValue([detail]);
    vi.mocked(getProviderDetail).mockResolvedValue(detail);
  }

  it.each([0, 0.012])("list shows metered even when normal is %s", async (normal) => {
    stubCatalog(provider("metered", normal));

    await apiListAction({});

    expect(output.join("\n")).toMatch(/financial[^\n]*usage-based/);
    expect(output.join("\n")).toContain("PRICING");
    expect(output.join("\n")).not.toContain("free");
    expect(output.join("\n")).not.toContain("$0.012");
  });

  it.each([0, 0.012])("provider show uses metered pricing when normal is %s", async (normal) => {
    stubCatalog(provider("metered", normal));

    await apiShowAction("financial");

    expect(output.join("\n")).toContain("Pricing:  usage-based (cost varies)");
    expect(output.join("\n")).not.toContain("from usage-based");
    expect(output.join("\n")).not.toContain("usage-based per request");
    expect(output.join("\n")).toContain("aisa quote for a request-specific estimate");
    expect(output.join("\n")).not.toContain("free");
    expect(output.join("\n")).not.toContain("$0.012");
  });

  it.each([0, 0.012])("endpoint show uses metered pricing when normal is %s", async (normal) => {
    stubCatalog(provider("metered", normal));

    await apiShowAction("financial", "news");

    expect(output.join("\n")).toContain("Pricing:  usage-based (cost varies)");
    expect(output.join("\n")).not.toContain("usage-based per request");
    expect(output.join("\n")).toContain("aisa quote for a request-specific estimate");
    expect(output.join("\n")).not.toContain("free");
    expect(output.join("\n")).not.toContain("$0.012");
  });

  it.each([[0, "free"], [0.000001, "$0.000001"]] as const)(
    "keeps fixed pricing %s legible in every view", async (normal, expected) => {
      stubCatalog(provider("per_request", normal));

      await apiListAction({});
      expect(output.join("\n")).toContain(expected);
      output.length = 0;
      await apiShowAction("financial");
      expect(output.join("\n")).toContain(`Pricing:  ${normal > 0 ? "from " : ""}${expected} per request`);
      output.length = 0;
      await apiShowAction("financial", "news");
      expect(output.join("\n")).toContain(`Pricing:  ${expected} per request`);
    }
  );

  it.each([0, 0.012])("adds quote guidance while preserving raw pricing %s in JSON for every view", async (normal) => {
    const detail = provider("metered", normal);
    const before = structuredClone(detail);
    const pricing_note = "Usage-based billing. Use aisa quote for a request-specific estimate.";
    const endpoint = { ...detail.endpoint_groups![0].endpoints[0], pricing_note };
    stubCatalog(detail);

    await apiListAction({ json: true });
    expect(JSON.parse(output.pop()!)).toEqual([{ ...detail, category: "finance", pricing_note }]);
    await apiShowAction("financial", undefined, { json: true });
    expect(JSON.parse(output.pop()!)).toEqual({
      ...detail,
      pricing_note,
      endpoint_groups: [{ ...detail.endpoint_groups![0], endpoints: [endpoint] }],
    });
    await apiShowAction("financial", "news", { json: true });
    expect(JSON.parse(output.pop()!)).toEqual(endpoint);
    expect(detail).toEqual(before);
    expect(output).toEqual([]);
  });

  it.each([0, 0.000001, undefined])("keeps non-metered or absent pricing %s unchanged in JSON", async (normal) => {
    const detail = provider("per_request", normal ?? 0);
    if (normal === undefined) {
      delete detail.pricing;
      delete detail.endpoint_groups![0].endpoints[0].pricing;
    }
    stubCatalog(detail);

    await apiListAction({ json: true });
    expect(JSON.parse(output.pop()!)).toEqual([{ ...detail, category: "finance" }]);
    await apiShowAction("financial", undefined, { json: true });
    expect(JSON.parse(output.pop()!)).toEqual(detail);
    await apiShowAction("financial", "news", { json: true });
    expect(JSON.parse(output.pop()!)).toEqual(detail.endpoint_groups![0].endpoints[0]);
    expect(output).toEqual([]);
  });

  it("uses each endpoint's own pricing type for guidance in provider JSON", async () => {
    const detail = provider("per_request", 0.000001);
    const endpoints = detail.endpoint_groups![0].endpoints;
    endpoints.push({ method: "GET", path: "/apis/v1/financial/quote", pricing: { type: "metered", normal: 0 } });
    stubCatalog(detail);

    await apiShowAction("financial", undefined, { json: true });
    const json = JSON.parse(output.pop()!);
    expect(json).not.toHaveProperty("pricing_note");
    expect(json.endpoint_groups[0].endpoints[0]).toEqual(endpoints[0]);
    expect(json.endpoint_groups[0].endpoints[1].pricing).toEqual(endpoints[1].pricing);
    expect(json.endpoint_groups[0].endpoints[1].pricing_note).toContain("aisa quote");
  });
});
