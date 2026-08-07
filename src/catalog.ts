import { publicRequest, cacheScope } from "./api.js";
import { readCache, writeCache, touchCache } from "./cache.js";
import { pool } from "./utils/pool.js";

/**
 * Client for the unauthenticated /info/apis catalog.
 *
 * Two properties of the upstream data shape everything here:
 *  - `endpoint_groups[].name` is an operator-entered label ("Zero", "One",
 *    "default") with no business meaning, so callers get a flat endpoint list.
 *  - `endpoints[].method` is hardcoded to GET server-side and must not be
 *    treated as authoritative.
 * The provider `id` is also not always the URL slug (provider `brave-search`
 * serves `/apis/v1/brave/...`), so the runnable slug is derived from the paths.
 */

export interface CatalogPricing {
  type: string;
  /** Dollars per request, as a float — not micros. */
  normal: number;
}

export interface CatalogProvider {
  id: string;
  endpoint_count: number;
  is_active: boolean;
  pricing?: CatalogPricing;
  updated_at?: string;
}

export interface CatalogEndpoint {
  /** Advisory only: the server hardcodes GET. */
  method: string;
  /** Full inner URI, e.g. /apis/v1/financial/news. */
  path: string;
  name?: string;
  description?: string;
  pricing?: CatalogPricing;
}

export interface CatalogDetail extends CatalogProvider {
  endpoint_groups?: Array<{ id?: string; name?: string; endpoints: CatalogEndpoint[] }>;
}

export interface ProviderHealth {
  id: string;
  status: "healthy" | "warning" | "failed" | "not_tested" | string;
  endpoint_count: number;
  healthy_count: number;
  failed_count: number;
  warning_count: number;
  not_tested_count: number;
  checked_at?: string;
}

const CATEGORY_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
const HEALTH_TTL_MS = 5 * 60 * 1000;

export const CATALOG_CONCURRENCY = Number(process.env.AISA_CATALOG_CONCURRENCY) || 6;

/** Fetch with disk caching and ETag revalidation; falls back to stale data offline. */
async function cachedGet<T>(
  path: string,
  cacheKey: string,
  ttlMs: number,
  refresh?: boolean
): Promise<T> {
  const cached = readCache<T>(cacheKey);
  if (cached?.fresh && !refresh) return cached.data;

  let res;
  try {
    res = await publicRequest<T>(path, { etag: refresh ? undefined : cached?.etag });
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }

  if (res.status === 304 && cached) {
    touchCache(cacheKey, ttlMs);
    return cached.data;
  }
  if (!res.data) {
    if (cached) return cached.data;
    throw new Error(`Catalog request failed: ${path} returned ${res.status}`);
  }

  writeCache(cacheKey, res.data, ttlMs, res.etag);
  return res.data;
}

export async function getProviders(options: { refresh?: boolean } = {}): Promise<CatalogProvider[]> {
  const data = await cachedGet<{ apis?: CatalogProvider[] }>(
    "info/apis/category",
    `catalog/${cacheScope()}/category.json`,
    CATEGORY_TTL_MS,
    options.refresh
  );
  return data.apis || [];
}

export async function getProviderDetail(
  id: string,
  options: { refresh?: boolean } = {}
): Promise<CatalogDetail> {
  const data = await cachedGet<{ api?: CatalogDetail }>(
    `info/apis/${encodeURIComponent(id)}`,
    `catalog/${cacheScope()}/${id.replace(/[^\w.-]/g, "_")}.json`,
    DETAIL_TTL_MS,
    options.refresh
  );
  if (!data.api) throw new Error(`Unknown API "${id}"`);
  return data.api;
}

export async function getHealth(options: { refresh?: boolean } = {}): Promise<ProviderHealth[]> {
  const data = await cachedGet<{ apis?: ProviderHealth[] }>(
    "info/apis/health",
    `catalog/${cacheScope()}/health.json`,
    HEALTH_TTL_MS,
    options.refresh
  );
  return data.apis || [];
}

/** Flatten a provider's groups — the group labels carry no meaning. */
export function flatEndpoints(detail: CatalogDetail): CatalogEndpoint[] {
  return (detail.endpoint_groups || [])
    .flatMap((g) => g.endpoints || [])
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Strip the /apis/v1 prefix: what you'd pass to `aisa run`. */
export function toRunPath(path: string): string {
  return path.replace(/^\/apis\/v1\//, "").replace(/^\/+/, "");
}

/**
 * The slug an endpoint is actually served under, which is not always the
 * provider id (provider `brave-search` serves `/apis/v1/brave/...`).
 */
export function runSlugOf(detail: CatalogDetail): string | undefined {
  const first = flatEndpoints(detail)[0];
  return first ? toRunPath(first.path).split("/")[0] : undefined;
}

export interface EndpointRef {
  provider: string;
  endpoint: CatalogEndpoint;
}

/**
 * Load every provider's endpoints. Cold this is ~29 requests and several
 * hundred KB, so it runs through a bounded pool with progress reporting; warm
 * it is entirely local.
 */
export async function getAllEndpoints(options: {
  refresh?: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ endpoints: EndpointRef[]; failed: string[] }> {
  const providers = await getProviders({ refresh: options.refresh });

  const details = await pool(
    providers.map((p) => () => getProviderDetail(p.id, { refresh: options.refresh })),
    CATALOG_CONCURRENCY,
    options.onProgress
  );

  const endpoints: EndpointRef[] = [];
  const failed: string[] = [];

  details.forEach((detail, i) => {
    if (!detail) {
      failed.push(providers[i].id);
      return;
    }
    for (const endpoint of flatEndpoints(detail)) {
      endpoints.push({ provider: providers[i].id, endpoint });
    }
  });

  return { endpoints, failed };
}

/**
 * Format a per-request price. Real values span $0.000001 to $0.08, so a fixed
 * number of decimals either rounds the cheap endpoints to $0.00 or pads the
 * rest with noise — keep two significant digits instead.
 */
export function formatPrice(usd?: number): string {
  if (usd == null) return "—";
  if (usd === 0) return "free";

  const precise = Number(usd.toPrecision(2));
  const text = precise.toString();
  // toString switches to exponent notation below 1e-6; expand it.
  return `$${text.includes("e") ? precise.toFixed(10).replace(/0+$/, "") : text}`;
}
