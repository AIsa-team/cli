import { getConfig } from "./config.js";
import { httpFetch } from "./utils/http.js";

/**
 * Deployed Tool Router origin (nginx / tools.aisa.one). Paths already include
 * `/v1/tool-router/...`, so this is an origin, not the LLM `/v1` base.
 * OpenAPI still lists api.aisa.one; that host 404s these paths.
 */
export const DEFAULT_ROUTER_URL = "https://tools.aisa.one";
/** Origin/prefix before `/v1/tool-router/...`. Harness and tests set this. */
export const ROUTER_URL_ENV = "AISA_ROUTER_BASE_URL";

export const ROUTER_PATHS = {
  search: "/v1/tool-router/aisa-search-tool",
  schema: "/v1/tool-router/aisa-batch-get-schema",
  quote: "/v1/tool-router/aisa-batch-quote",
  call: "/v1/tool-router/aisa-batch-use",
} as const;

export type RouterOperation = keyof typeof ROUTER_PATHS;

/**
 * Origin of the shared Tool Router HTTP service.
 *
 * Independent of resolveBases(): those rebuild `/v1` and `/apis/v1` for the
 * LLM gateway and integration catalog. A test harness points this at a
 * controlled Router via AISA_ROUTER_BASE_URL or config routerUrl.
 */
export function resolveRouterBase(): string {
  const env = process.env[ROUTER_URL_ENV];
  if (env && env.trim()) return stripTrailingSlash(env.trim());

  const configured = getConfig("routerUrl");
  if (typeof configured === "string" && configured.trim()) {
    return stripTrailingSlash(configured.trim());
  }

  return DEFAULT_ROUTER_URL;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export interface RouterRequest {
  operation: RouterOperation;
  /** Raw application JSON. Sent unchanged so numeric tokens survive. */
  body: string;
  /** Bearer credential without the "Bearer " prefix, if any. */
  apiKey?: string;
}

export interface RouterHttpResult {
  status: number;
  raw: string;
}

/**
 * POST one Router operation. Never retries: quote and use are not safe to
 * replay, and search/schema must not hide a failed attempt.
 */
export async function routerPost(request: RouterRequest): Promise<RouterHttpResult> {
  const url = `${resolveRouterBase()}${ROUTER_PATHS[request.operation]}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-aisa-source": "cli",
  };
  if (request.apiKey) {
    headers.Authorization = `Bearer ${request.apiKey}`;
  }

  const res = await httpFetch(url, {
    method: "POST",
    headers,
    body: request.body,
    idempotent: false,
    // Never follow: a 307/308 to aisa-batch-use would keep POST+body+auth.
    redirect: "manual",
  });

  return { status: res.status, raw: await res.text() };
}
