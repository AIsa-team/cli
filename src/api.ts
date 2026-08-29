import { BASE_URL } from "./constants.js";
import { httpFetch, INFO_TIMEOUT_MS } from "./utils/http.js";
import { getConfig } from "./config.js";
import type { ApiResponse, CostInfo } from "./types.js";

export interface Bases {
  /** LLM gateway: chat, models, credits, video. */
  llm: string;
  /** Integration APIs: every provider slug. */
  domain: string;
  /** Unauthenticated catalog and pricing endpoints. */
  info: string;
}

/**
 * Derive every base path from one configured root.
 *
 * `baseUrl` has shipped with a default of `https://api.aisa.one/v1`, so it is
 * already persisted with the `/v1` suffix in every existing user's config —
 * changing the schema default would not rewrite it. Strip whichever suffix is
 * present and rebuild, so both the historical value and a bare root work.
 */
export function resolveBases(): Bases {
  const configured = (getConfig("baseUrl") as string | undefined) || BASE_URL;
  const root = configured
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/apis\/v1$/, "")
    .replace(/\/v1$/, "")
    .replace(/\/+$/, "");

  return { llm: `${root}/v1`, domain: `${root}/apis/v1`, info: root };
}

/**
 * Read the gateway's billing headers off a response.
 *
 * Returns undefined when none are present — which is the common case, since
 * only metered integration routes report an amount. Values are passed through
 * as strings: they are fixed-point decimals produced server-side, and parsing
 * them into floats would only lose precision on the way to being printed.
 */
export function parseCost(res: Response): CostInfo | undefined {
  const cost: CostInfo = {
    priceUsd: res.headers.get("x-aisa-price-usd") || undefined,
    pricingStrategy: res.headers.get("x-aisa-pricing-strategy") || undefined,
    pricingVersion: res.headers.get("x-aisa-pricing-version") || undefined,
    creditModel: res.headers.get("x-aisa-credit-model") || undefined,
    estimatedCredits: res.headers.get("x-aisa-estimated-credits") || undefined,
    accountedCredits: res.headers.get("x-aisa-accounted-credits") || undefined,
    requestMultiplier: res.headers.get("x-aisa-request-multiplier") || undefined,
    priceKey: res.headers.get("x-aisa-price-key") || undefined,
    requestId: res.headers.get("x-request-id") || undefined,
  };

  return Object.values(cost).some((v) => v !== undefined) ? cost : undefined;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  stream?: boolean;
  headers?: Record<string, string>;
  /** Use domain API base URL (/apis/v1) instead of LLM base (/v1) */
  domain?: boolean;
  /**
   * Safe to send more than once, so a transient failure can be retried.
   * Must be set deliberately: this CLI POSTs for reads and for writes alike,
   * and a retried write posts a second tweet or bills a second video job.
   * See utils/http.ts for why `chat` stays out of this even though a
   * completion reads rather than writes.
   */
  idempotent?: boolean;
  /** Overrides the default 30s budget for a slow endpoint. */
  timeoutMs?: number;
}

export async function apiRequest<T = unknown>(
  apiKey: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = "GET", query, body, headers: extraHeaders, domain } = options;
  const bases = resolveBases();
  const baseUrl = domain ? bases.domain : bases.llm;

  let url = `${baseUrl}/${endpoint}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "x-aisa-source": "cli",
    ...extraHeaders,
  };

  const res = await httpFetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    idempotent: options.idempotent ?? method === "GET",
    timeoutMs: options.timeoutMs,
  });

  if (!res.ok) {
    const text = await res.text();
    let errorMsg: string;
    try {
      const json = JSON.parse(text);
      errorMsg = json.error?.message || json.error || json.message || text;
    } catch {
      errorMsg = text;
    }
    return { success: false, error: `${res.status}: ${errorMsg}`, cost: parseCost(res) };
  }

  const data = (await res.json()) as T;
  return { success: true, data, cost: parseCost(res) };
}

export async function apiRequestRaw(
  apiKey: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<Response> {
  const { method = "GET", query, body, headers: extraHeaders, domain } = options;
  const bases = resolveBases();
  const baseUrl = domain ? bases.domain : bases.llm;

  let url = `${baseUrl}/${endpoint}`;
  if (query) {
    const params = new URLSearchParams(query);
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "x-aisa-source": "cli",
    ...extraHeaders,
  };

  return httpFetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    idempotent: options.idempotent ?? method === "GET",
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Cache namespace for data served by the configured gateway. Catalog, model
 * and coin-list caches must be keyed by the host they came from: a fixed key
 * would keep serving one server's catalog for hours after `config set baseUrl`
 * switches to another.
 */
export function cacheScope(): string {
  return resolveBases()
    .info.replace(/^https?:\/\//, "")
    .replace(/[^\w.-]/g, "_");
}

/**
 * Request an unauthenticated endpoint under /info or /pricing. Browsing the
 * catalog does not require an API key, and demanding one would turn discovery
 * into a signup wall.
 */
export async function publicRequest<T = unknown>(
  path: string,
  options: { etag?: string } = {}
): Promise<{ status: number; data?: T; etag?: string }> {
  const headers: Record<string, string> = { "x-aisa-source": "cli" };
  if (options.etag) headers["If-None-Match"] = options.etag;

  // Catalog and pricing are unauthenticated GETs against a cache — retrying
  // one is free, and failing one degrades every discovery command.
  const res = await httpFetch(`${resolveBases().info}/${path.replace(/^\/+/, "")}`, {
    headers,
    idempotent: true,
    timeoutMs: INFO_TIMEOUT_MS,
  });

  if (res.status === 304) return { status: 304 };
  if (!res.ok) return { status: res.status };

  return {
    status: res.status,
    data: (await res.json()) as T,
    etag: res.headers.get("etag") || undefined,
  };
}
