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

  const endpointMap: Record<string, { endpoint: string; method: "GET" | "POST"; paramStyle: "query" | "body" }> = {
    smart: { endpoint: "search/smart", method: "GET", paramStyle: "query" },
    full: { endpoint: "search/full", method: "GET", paramStyle: "query" },
    youtube: { endpoint: "youtube/search", method: "GET", paramStyle: "query" },
    scholar: { endpoint: "scholar/search/scholar", method: "POST", paramStyle: "query" },
    tavily: { endpoint: "tavily/search", method: "POST", paramStyle: "body" },
  };

  const config = endpointMap[type];
  if (!config) {
    spinner.fail(`Unknown search type: ${type}`);
    error("Valid types: smart, full, youtube, scholar, tavily");
    return;
  }

  // Build request options
  const reqOpts: Parameters<typeof apiRequest>[2] = {
    method: config.method,
    domain: true,
  };

  if (config.paramStyle === "query") {
    // GET-style search endpoints use 'q' for smart/full/youtube, 'query' for scholar
    const qParam = type === "scholar" ? "query" : "q";
    reqOpts.query = { [qParam]: query };
    if (options.limit) {
      reqOpts.query[type === "scholar" ? "max_num_results" : "count"] = options.limit;
    }
  } else {
    // Tavily uses POST body
    reqOpts.body = {
      query,
      ...(options.limit ? { max_results: parseInt(options.limit) } : {}),
    };
  }

  const res = await apiRequest(key, config.endpoint, reqOpts);

  if (!res.success) {
    spinner.fail("Search failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    // Format search results nicely
    const data = res.data as Record<string, unknown>;

    // Smart/Full search format
    if (data?.webPages && typeof data.webPages === "object") {
      const pages = data.webPages as { value?: Array<{ name: string; url: string; snippet: string }> };
      if (pages.value) {
        for (const result of pages.value) {
          console.log(`\n  ${chalk.cyan.bold(result.name)}`);
          console.log(`  ${chalk.gray(result.url)}`);
          if (result.snippet) console.log(`  ${result.snippet}`);
        }
        console.log(chalk.gray(`\n  ${pages.value.length} results`));
        return;
      }
    }

    // Fallback to generic JSON display
    console.log(formatJson(res.data));
  }
}

export async function scholarAction(
  query: string,
  options: { limit?: string; raw?: boolean }
): Promise<void> {
  return webSearchAction(query, { type: "scholar", ...options });
}
