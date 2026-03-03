import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest, apiRequestRaw } from "../api.js";
import { error, formatJson } from "../utils/display.js";
import { handleSSEStream } from "../utils/streaming.js";

export async function runAction(
  slug: string,
  path: string,
  options: {
    q?: string[];
    d?: string;
    method?: string;
    raw?: boolean;
    stream?: boolean;
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

  const endpoint = `${slug}${path}`;

  // Streaming mode
  if (options.stream) {
    const res = await apiRequestRaw(key, endpoint, {
      method,
      query: Object.keys(query).length > 0 ? query : undefined,
      body,
      headers: { Accept: "text/event-stream" },
    });

    if (!res.ok) {
      const text = await res.text();
      error(`${res.status}: ${text}`);
      return;
    }

    await handleSSEStream(
      res,
      (token) => process.stdout.write(token),
      () => console.log()
    );
    return;
  }

  // Normal mode
  const spinner = ora(`Calling ${slug} ${path}...`).start();

  const res = await apiRequest(key, endpoint, {
    method,
    query: Object.keys(query).length > 0 ? query : undefined,
    body,
  });

  if (!res.success) {
    spinner.fail("API call failed");
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
