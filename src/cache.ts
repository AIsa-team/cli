import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Disk cache for data the CLI fetches but does not own: the API catalog and the
 * skills repository index.
 *
 * Deliberately separate from `conf`, which stores settings. conf is a single
 * synchronously-rewritten file, so putting hundreds of KB of catalog in it would
 * make `aisa config list` unreadable and would rewrite the API key on every
 * catalog refresh. This cache is disposable — deleting the whole directory is
 * always safe.
 */

interface Envelope<T> {
  fetchedAt: number;
  ttlMs: number;
  etag?: string;
  data: T;
}

export interface CacheHit<T> {
  data: T;
  etag?: string;
  /** False when the entry is past its TTL but still usable as a fallback. */
  fresh: boolean;
}

export function cacheDir(): string {
  return process.env.AISA_CACHE_DIR || join(homedir(), ".aisa", "cache");
}

function cachePath(key: string): string {
  return join(cacheDir(), key);
}

/**
 * Read a cached entry. Returns stale entries too (with `fresh: false`) so
 * callers can revalidate with an ETag or fall back to them when offline.
 * A corrupt or unreadable file is treated as a miss, never an error.
 */
export function readCache<T>(key: string): CacheHit<T> | undefined {
  try {
    const raw = readFileSync(cachePath(key), "utf-8");
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || typeof env !== "object" || typeof env.fetchedAt !== "number") {
      return undefined;
    }
    return {
      data: env.data,
      etag: env.etag,
      fresh: Date.now() - env.fetchedAt < env.ttlMs,
    };
  } catch {
    return undefined;
  }
}

/** Write an entry. Cache failures are never fatal — a full disk shouldn't break a command. */
export function writeCache<T>(key: string, data: T, ttlMs: number, etag?: string): void {
  try {
    const path = cachePath(key);
    mkdirSync(dirname(path), { recursive: true });
    const env: Envelope<T> = { fetchedAt: Date.now(), ttlMs, etag, data };
    writeFileSync(path, JSON.stringify(env), "utf-8");
  } catch {
    // ignore
  }
}

/** Refresh an existing entry's timestamp, for HTTP 304 responses. */
export function touchCache(key: string, ttlMs: number): void {
  const hit = readCache(key);
  if (hit) writeCache(key, hit.data, ttlMs, hit.etag);
}

export function clearCache(): number {
  const dir = cacheDir();
  if (!existsSync(dir)) return 0;
  const count = countFiles(dir);
  rmSync(dir, { recursive: true, force: true });
  return count;
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    n += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return n;
}
