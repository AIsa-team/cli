import chalk from "chalk";
import ora from "ora";
import { requireApiKey } from "../config.js";
import { apiRequest, apiRequestRaw, parseCost } from "../api.js";
import { error, formatJson, hint } from "../utils/display.js";
import { handleSSEStream } from "../utils/streaming.js";
import { LLM_ROUTE_PREFIXES } from "../constants.js";
import { getProviders } from "../catalog.js";
import type { CostInfo } from "../types.js";

export interface RunTarget {
  /** Which base URL to use: the LLM gateway (/v1) or integration APIs (/apis/v1). */
  base: "llm" | "domain";
  /** Path relative to that base, with no leading slash. */
  endpoint: string;
}

/**
 * Decide which base URL a `run` invocation targets.
 *
 * Integration APIs are the default: there are ~29 providers and the set grows
 * without a CLI release, so anything not recognised as an LLM gateway route
 * goes to /apis/v1. See LLM_ROUTE_PREFIXES for why the whitelist sits on that
 * side.
 */
export function resolveRunTarget(
  slug: string,
  path: string,
  options: { llm?: boolean; domain?: boolean } = {}
): RunTarget {
  const cleanSlug = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  const endpoint = cleanPath ? `${cleanSlug}/${cleanPath}` : cleanSlug;

  let base: "llm" | "domain";
  if (options.llm) {
    base = "llm";
  } else if (options.domain) {
    base = "domain";
  } else {
    base = LLM_ROUTE_PREFIXES.includes(cleanSlug.split("/")[0]) ? "llm" : "domain";
  }

  return { base, endpoint };
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

/**
 * Turn a 404 into a usable next step. This runs only on failure, so the catalog
 * stays a diagnostic aid rather than something `run` depends on to work.
 */
async function suggestSlug(slug: string): Promise<void> {
  try {
    const providers = await getProviders();
    const ids = providers.map((p) => p.id);
    const near = ids
      .map((id) => ({ id, d: editDistance(slug.toLowerCase(), id.toLowerCase()) }))
      .filter((c) => c.d <= 3 || c.id.includes(slug) || slug.includes(c.id))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((c) => c.id);

    if (near.length > 0) {
      hint(`Did you mean: ${near.join(", ")}?`);
    }
    hint("List APIs: aisa api list");
  } catch {
    // catalog unavailable — the error above is enough
  }
}

/**
 * Report what a call cost, on stderr so `--raw | jq` stays a clean pipe.
 *
 * Only metered routes report an amount; plain integration responses carry a
 * price key and the LLM gateway sends no billing headers at all. Say so rather
 * than printing nothing, so an empty report is not read as "this was free".
 */
function reportCost(cost: CostInfo | undefined): void {
  const dim = (label: string, value: string) =>
    console.error(chalk.gray(`  ${label.padEnd(12)} ${value}`));

  if (!cost) {
    console.error(chalk.gray("  cost         not reported by this route"));
    return;
  }

  if (cost.priceUsd) dim("cost", `$${cost.priceUsd} USD`);
  if (cost.accountedCredits) {
    const estimate =
      cost.estimatedCredits && cost.estimatedCredits !== cost.accountedCredits
        ? ` (estimated ${cost.estimatedCredits})`
        : "";
    dim("credits", `${cost.accountedCredits}${estimate}`);
  }
  if (cost.creditModel) dim("credit model", cost.creditModel);
  if (cost.pricingStrategy) {
    const version = cost.pricingVersion ? ` v${cost.pricingVersion}` : "";
    dim("pricing", `${cost.pricingStrategy}${version}`);
  }
  if (cost.priceKey) dim("price key", cost.priceKey);
  if (cost.requestId) dim("request id", cost.requestId);

  if (!cost.priceUsd) {
    console.error(chalk.gray("  no amount reported — check `aisa account balance` for actual spend"));
  }
}

export async function runAction(
  slug: string,
  path: string,
  options: {
    q?: string[];
    d?: string;
    method?: string;
    raw?: boolean;
    stream?: boolean;
    llm?: boolean;
    domain?: boolean;
    showCost?: boolean;
  }
): Promise<void> {
  const key = requireApiKey();

  // Parse query params
  const query: Record<string, string> = {};
  if (options.q) {
    for (const q of options.q) {
      const pairs = q.split("&");
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx > 0) {
          query[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
        }
      }
    }
  }

  // Parse body
  let body: unknown;
  if (options.d) {
    try {
      body = JSON.parse(options.d);
    } catch {
      error("Invalid JSON body. Use -d '{\"key\": \"value\"}'");
      process.exit(1);
    }
  }

  // Detect method
  const method = (options.method || (body ? "POST" : "GET")).toUpperCase() as
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE";

  const { base, endpoint } = resolveRunTarget(slug, path, options);
  const isDomain = base === "domain";

  // Streaming mode
  if (options.stream) {
    const res = await apiRequestRaw(key, endpoint, {
      method,
      query: Object.keys(query).length > 0 ? query : undefined,
      body,
      headers: { Accept: "text/event-stream" },
      domain: isDomain,
    });

    if (!res.ok) {
      const text = await res.text();
      error(`${res.status}: ${text}`);
      if (options.showCost) reportCost(parseCost(res));
      return;
    }

    await handleSSEStream(
      res,
      (token) => process.stdout.write(token),
      () => console.log()
    );
    if (options.showCost) reportCost(parseCost(res));
    return;
  }

  // Normal mode
  const spinner = ora(`Calling ${slug} ${path}...`).start();

  const res = await apiRequest(key, endpoint, {
    method,
    query: Object.keys(query).length > 0 ? query : undefined,
    body,
    domain: isDomain,
  });

  if (!res.success) {
    spinner.fail("API call failed");
    error(res.error || "Unknown error");
    if (isDomain && (res.error || "").includes("api endpoint not found")) {
      await suggestSlug(slug);
    }
    if (options.showCost) reportCost(res.cost);
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(formatJson(res.data));
  }

  if (options.showCost) reportCost(res.cost);
}
