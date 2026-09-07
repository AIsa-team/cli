import { readCache, writeCache } from "../cache.js";
import { VERSION } from "../constants.js";
import { detectInstall } from "./install-method.js";

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

/**
 * Say it once, at the end of whatever command the user actually ran.
 *
 * The check already existed but only `connect` ever read it, and `connect` is
 * the command a person runs once. Everyone who then lived in `chat`, `run`
 * and `twitter` for a month was never told a release had happened.
 *
 * Three things keep it from becoming noise:
 *
 *  · Nothing is printed unless stdout is a terminal. Most commands here emit
 *    JSON, and a friendly line appended to a pipe is corrupted output.
 *  · Nothing is printed for a copy that cannot be updated — npx is current by
 *    definition, and a working copy is updated with git.
 *  · The lookup is read from the day-old cache, not the network. A stale
 *    cache is refreshed within a tight budget and simply skipped if the
 *    registry is slow: no command pays for this at the moment it exits.
 */
const ANNOUNCE_BUDGET_MS = 700;

let announced = false;

/** Mark it said, for a surface that prints its own line (connect does). */
export function markUpdateAnnounced(): void {
  announced = true;
}

export interface AnnounceOptions {
  current?: string;
  /** Injectable for tests, all of them. */
  isTTY?: boolean;
  updatable?: boolean;
  lookup?: () => Promise<string | undefined>;
  write?: (line: string) => void;
}

/** Returns the line it printed, or undefined when it stayed quiet. */
export async function announceUpdate(o: AnnounceOptions = {}): Promise<string | undefined> {
  if (announced) return undefined;
  announced = true;
  const current = o.current ?? VERSION;
  if (!(o.isTTY ?? process.stdout.isTTY)) return undefined;
  if (process.env.AISA_NO_UPDATE_NOTICE) return undefined;
  if (!(o.updatable ?? Boolean(detectInstall().command))) return undefined;
  let latest: string | undefined;
  try {
    latest = await Promise.race([
      (o.lookup ?? (() => checkForUpdate({ current })))(),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), ANNOUNCE_BUDGET_MS)),
    ]);
  } catch {
    return undefined;
  }
  if (!latest) return undefined;
  const line = `\nA newer aisa is out — ${current} → ${latest}. Run \u001b[1maisa update\u001b[0m\n`;
  (o.write ?? ((l: string) => process.stdout.write(l)))(line);
  return line;
}

/** Tests only: the once-per-process latch has to be resettable. */
export function resetUpdateAnnouncement(): void {
  announced = false;
}
