import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson } from "../utils/display.js";

export async function webSearchAction(
  query: string,
  options: { type?: string; limit?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const type = options.type || "smart";
  const spinner = ora(`Searching (${type})...`).start();

  const endpointMap: Record<string, { endpoint: string; method: "GET" | "POST" }> = {
    smart: { endpoint: "search/smart", method: "GET" },
    full: { endpoint: "search/full", method: "GET" },
    youtube: { endpoint: "youtube/search", method: "GET" },
    scholar: { endpoint: "scholar/search", method: "POST" },
    tavily: { endpoint: "tavily/search", method: "POST" },
  };

  const config = endpointMap[type];
  if (!config) {
    spinner.fail(`Unknown search type: ${type}`);
    error("Valid types: smart, full, youtube, scholar, tavily");
    return;
  }

  const res = await apiRequest(key, config.endpoint, {
    method: config.method,
    ...(config.method === "GET"
      ? { query: { query, ...(options.limit ? { limit: options.limit } : {}) } }
      : { body: { query, limit: parseInt(options.limit || "10") } }),
  });

  if (!res.success) {
    spinner.fail("Search failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(formatJson(res.data));
  }
}

export async function scholarAction(
  query: string,
  options: { limit?: string; raw?: boolean }
): Promise<void> {
  return webSearchAction(query, { type: "scholar", ...options });
}
