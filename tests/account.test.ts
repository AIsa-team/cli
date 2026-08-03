import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balanceAction, formatMicrosUSD } from "../src/commands/account.js";

const balance = {
  currency: "USD",
  account_balance_micros_usd: 2_500_000,
  available_balance_micros_usd: 1_000_000,
  api_key: {
    unlimited: false,
    remaining_micros_usd: 1_000_000,
    used_micros_usd: 300_000,
  },
  as_of: "2026-08-03T12:00:00Z",
};

describe("balanceAction", () => {
  beforeEach(() => {
    process.env.AISA_API_KEY = "test-balance-key";
  });

  afterEach(() => {
    delete process.env.AISA_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("formats microdollars without floating-point drift", () => {
    expect(formatMicrosUSD(2_500_000)).toBe("$2.50");
    expect(formatMicrosUSD(2_505_001)).toBe("$2.51");
    expect(formatMicrosUSD(1_999_999)).toBe("$2.00");
    expect(formatMicrosUSD(-1_500_000)).toBe("-$1.50");
  });

  it("requests the balance endpoint with the API key and renders the summary", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(balance), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await balanceAction();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.aisa.one/v1/credits/balance");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-balance-key");
    expect(log.mock.calls.map(([line]) => line).join("\n")).toContain("Balance:");
    expect(log.mock.calls.map(([line]) => line).join("\n")).toContain("$2.50 USD");
    expect(log.mock.calls.map(([line]) => line).join("\n")).toContain("$1.00 USD");
    expect(log.mock.calls.map(([line]) => line).join("\n")).not.toContain("test-balance-key");
  });

  it("renders unlimited keys", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ...balance,
      api_key: { ...balance.api_key, unlimited: true },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await balanceAction();

    expect(log.mock.calls.map(([line]) => line).join("\n")).toContain("API key limit:       Unlimited");
  });

  it("supports raw JSON output", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(balance), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await balanceAction({ json: true });

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(balance);
  });

  it.each([401, 403, 404, 500])("raises API errors for HTTP %s", async (status) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "balance unavailable" }), { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(balanceAction()).rejects.toThrow(`${status}: balance unavailable`);
  });

  it("raises network errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(balanceAction()).rejects.toThrow("connection refused");
  });
});
