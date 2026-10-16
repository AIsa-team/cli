import { publicRequest, cacheScope } from "./api.js";
import { readCache, writeCache, touchCache } from "./cache.js";

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
  /** Runtime reference estimate in dollars; unavailable estimates are not zero prices. */
  normal?: number;
  estimate_unavailable?: boolean;
  /** Runtime's pricing declaration; provider costs do not determine customer charges. */
  details?: { customer_pricing?: string; [key: string]: unknown };
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

const CATEGORY_TTL_MS = 5 * 60 * 1000;
const DETAIL_TTL_MS = 5 * 60 * 1000;
const HEALTH_TTL_MS = 5 * 60 * 1000;

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
    if (cached) {
      console.error("Warning: catalog refresh failed; showing a stale cached reference. Use aisa schema and aisa quote before calling.");
      return cached.data;
    }
    throw err;
  }

  if (res.status === 304 && cached) {
    touchCache(cacheKey, ttlMs);
    return cached.data;
  }
  if (!res.data) {
    if (cached) {
      console.error("Warning: catalog refresh failed; showing a stale cached reference. Use aisa schema and aisa quote before calling.");
      return cached.data;
    }
    throw new Error(`Catalog request failed: ${path} returned ${res.status}`);
  }

  writeCache(cacheKey, res.data, ttlMs, res.etag);
  return res.data;
}

export async function getProviders(options: { refresh?: boolean } = {}): Promise<CatalogProvider[]> {
  const data = await cachedGet<{ apis?: CatalogProvider[] }>(
    "info/apis/category",
    `catalog-v2/${cacheScope()}/category.json`,
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
    `catalog-v2/${cacheScope()}/${id.replace(/[^\w.-]/g, "_")}.json`,
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

/** Strip the /apis/v1 prefix from a catalog path. */
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

/**
 * Format catalog pricing, keeping metered billing distinct from a free request.
 * Fixed prices span $0.000001 to $0.08, so a fixed
 * number of decimals either rounds the cheap endpoints to $0.00 or pads the
 * rest with noise. Preserve the supplied amount without rounding its rate.
 */
export function formatPrice(pricing?: CatalogPricing): string {
  if (pricing?.type === "metered") return "usage-based";
  if (pricing?.estimate_unavailable) return "—";

  const usd = pricing?.normal;
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "free";

  const text = usd.toString();
  if (!text.includes("e")) return `$${text}`;
  // Expand the supplied numeric text without rounding tiny nonzero rates.
  const [coefficient, exponent] = text.split("e");
  const negative = coefficient.startsWith("-");
  const [whole, fraction = ""] = (negative ? coefficient.slice(1) : coefficient).split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
    : digits.slice(0, point) + "." + digits.slice(point);
  return `$${negative ? "-" : ""}${expanded}`;
}
