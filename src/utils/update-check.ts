import { readCache, writeCache } from "../cache.js";
import { VERSION } from "../constants.js";

/**
 * Throttled, best-effort check for a newer published version.
 *
 * `connect` already makes a network call before it does anything else
 * (fetchLiveServers), so piggybacking one more cheap lookup costs nothing —
 * but only once a day: the npm-registry hit is cached like the API catalog
 * and skills index (see cache.ts), so every other run within the window
 * reads the last answer off disk instead of asking again.
 *
 * Never throws and never blocks longer than FETCH_TIMEOUT_MS. Offline, a
 * timeout, or a non-200 all resolve to "nothing to report" rather than an
 * error — a stale local install is not this function's problem to surface
 * loudly, just to mention.
 */

const CACHE_KEY = "update-check";
const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1_500;
const PACKAGE = "@aisa-one/cli";

interface UpdateCheckData {
  latest: string;
}

/** Compares dotted numeric versions ("0.3.0" < "0.10.0"); non-numeric parts sort as 0. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((p) => parseInt(p, 10) || 0);
  const b = current.split(".").map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export interface CheckForUpdateOptions {
  /** Injectable for tests; defaults to a real npm-registry lookup. */
  fetchLatest?: () => Promise<string | undefined>;
  current?: string;
}

async function defaultFetchLatest(): Promise<string | undefined> {
  const res = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { version?: string };
  return json.version;
}

/** Returns the newer version string if one is available, otherwise undefined. */
export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<string | undefined> {
  const current = options.current ?? VERSION;
  const fetchLatest = options.fetchLatest ?? defaultFetchLatest;

  const cached = readCache<UpdateCheckData>(CACHE_KEY);
  if (cached?.fresh) {
    return isNewer(cached.data.latest, current) ? cached.data.latest : undefined;
  }

  try {
    const latest = await fetchLatest();
    if (!latest) return cached && isNewer(cached.data.latest, current) ? cached.data.latest : undefined;
    writeCache<UpdateCheckData>(CACHE_KEY, { latest }, CHECK_TTL_MS);
    return isNewer(latest, current) ? latest : undefined;
  } catch {
    return cached && isNewer(cached.data.latest, current) ? cached.data.latest : undefined;
  }
}
