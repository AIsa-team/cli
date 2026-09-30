import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../src/cli-error.js";

/**
 * Usage is a pure query plus a table. The gateway call is mocked so these
 * tests can pin the window, the trim, and the dollars without a network.
 */

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  requireAccessToken: async () => "test-token",
}));
vi.mock("../src/api.js", () => ({
  apiRequest: mocks.apiRequest,
}));

import {
  formatUsageDate,
  parseUsageOptions,
  renderUsageReport,
  selectRecentBuckets,
  usageAction,
  type UsageBucket,
  type UsageResponse,
} from "../src/commands/account.js";

const NOW = 1_700_000_000;

function bucket(start: number, patch: Partial<UsageBucket> = {}): UsageBucket {
  return {
    start_time: start,
    end_time: start + 86_400,
    requests: 0,
    failed_requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    usage_value_micros_usd: 0,
    charged_micros_usd: 0,
    ...patch,
  };
}

function plain(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

describe("parseUsageOptions", () => {
  it("defaults to 7 days and scope=key", () => {
    expect(parseUsageOptions({}, NOW).query).toEqual({
      start_time: String(NOW - 7 * 86_400),
      scope: "key",
    });
  });

  it("accepts a 1-day window", () => {
    expect(parseUsageOptions({ days: "1" }, NOW).query.start_time).toBe(String(NOW - 86_400));
  });

  it("accepts a 31-day window and an account scope", () => {
    expect(parseUsageOptions({ days: "31", scope: "account" }, NOW)).toEqual({
      query: {
        start_time: String(NOW - 31 * 86_400),
        scope: "account",
      },
    });
  });

  it.each(["0", "32", "-1", "7.5", "abc"])("rejects --days %s because the window caps at 31", (days) => {
    expect(() => parseUsageOptions({ days }, NOW)).toThrow(CliError);
    expect(() => parseUsageOptions({ days }, NOW)).toThrow(/31/);
  });

  it("rejects an unknown scope", () => {
    expect(() => parseUsageOptions({ scope: "user" }, NOW)).toThrow(/key/);
  });
});

describe("selectRecentBuckets", () => {
  const buckets = [
    bucket(NOW),
    bucket(NOW - 2 * 86_400),
    bucket(NOW - 86_400),
  ];

  it("keeps only the latest N buckets, in chronological order", () => {
    expect(selectRecentBuckets(buckets, 2).map((item) => item.start_time)).toEqual([
      NOW - 86_400,
      NOW,
    ]);
  });

  it("returns every bucket when limit is omitted", () => {
    expect(selectRecentBuckets(buckets).map((item) => item.start_time)).toEqual([
      NOW - 2 * 86_400,
      NOW - 86_400,
      NOW,
    ]);
  });
});

describe("renderUsageReport", () => {
  it("formats charged micros as dollars and sums the visible rows", () => {
    const text = plain(renderUsageReport([
      bucket(NOW - 86_400, {
        requests: 2,
        failed_requests: 1,
        input_tokens: 10,
        output_tokens: 4,
        charged_micros_usd: 2_500_000,
      }),
      bucket(NOW, {
        requests: 3,
        failed_requests: 0,
        input_tokens: 5,
        output_tokens: 6,
        charged_micros_usd: 1_500_000,
      }),
    ]));
    expect(text).toContain(formatUsageDate(NOW - 86_400));
    expect(text).toContain(formatUsageDate(NOW));
    expect(text).toContain("$2.50");
    expect(text).toContain("$1.50");
    expect(text).toContain("Total");
    expect(text).toContain("$4.00");
    expect(text).toMatch(/Total\s+│\s+5\s+│\s+1\s+│\s+15\s+│\s+10\s+│\s+\$4\.00/);
  });

  it("says so when the window has no buckets", () => {
    expect(renderUsageReport([])).toContain("No usage in this window");
  });
});

describe("usageAction", () => {
  let logged: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    mocks.apiRequest.mockReset();
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function response(buckets: UsageBucket[]): UsageResponse {
    return {
      scope: "key",
      currency: "USD",
      start_time: NOW - 7 * 86_400,
      end_time: NOW,
      bucket_width: "1d",
      totals: buckets[0] ?? bucket(NOW),
      buckets,
    };
  }

  it("requests /v1/usage and prints raw JSON when asked", async () => {
    const data = response([
      bucket(NOW - 86_400, { charged_micros_usd: 2_500_000 }),
      bucket(NOW, { charged_micros_usd: 1_500_000 }),
    ]);
    mocks.apiRequest.mockResolvedValue({ success: true, data });

    await usageAction({ json: true, days: "7", scope: "account", limit: "1" });

    expect(mocks.apiRequest).toHaveBeenCalledWith("test-token", "usage", {
      query: { start_time: String(NOW - 7 * 86_400), scope: "account" },
    });
    expect(JSON.parse(logged.join("\n"))).toEqual(data);
  });

  it("trims the table to the latest N buckets", async () => {
    const data = response([
      bucket(NOW - 2 * 86_400, { requests: 9, charged_micros_usd: 9_000_000 }),
      bucket(NOW - 86_400, { requests: 2, charged_micros_usd: 2_500_000 }),
      bucket(NOW, { requests: 3, charged_micros_usd: 1_500_000 }),
    ]);
    mocks.apiRequest.mockResolvedValue({ success: true, data });

    await usageAction({ days: "31", limit: "2" });

    const text = plain(logged.join("\n"));
    expect(text).not.toContain(formatUsageDate(NOW - 2 * 86_400));
    expect(text).toContain(formatUsageDate(NOW - 86_400));
    expect(text).toContain(formatUsageDate(NOW));
    expect(text).toContain("$2.50");
    expect(text).toContain("$1.50");
    expect(text).toContain("$4.00");
    expect(text).not.toContain("$9.00");
  });

  it("does not call the gateway when --days is outside 1-31", async () => {
    await expect(usageAction({ days: "32" })).rejects.toThrow(/31/);
    await expect(usageAction({ days: "0" })).rejects.toThrow(/31/);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it("prints the gateway error and fails the command", async () => {
    mocks.apiRequest.mockResolvedValue({ success: false, error: "400: window too large" });
    await expect(usageAction({ days: "7" })).rejects.toThrow("400: window too large");
    expect(logged.join("\n")).not.toContain("Requests");
  });
});
