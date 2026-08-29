/**
 * Every HTTP request this CLI makes goes through here.
 *
 * Two things were missing from the bare `fetch` calls this replaces, and both
 * were felt: no timeout, so a stalled connection hung the command with no way
 * out; and no retry, so a single dropped packet surfaced as `Error: fetch
 * failed` with nothing else to go on. Measured against the live gateway on
 * 2026-08-24, roughly one call in three failed that way on a flaky link.
 *
 * This is the HTTP twin of utils/exec.ts, and exists for the same reason: the
 * fix belongs in one place rather than being remembered at every call site.
 *
 * ── What is retried ────────────────────────────────────────────────────────
 *
 * Only requests the caller marks idempotent. That is not the same as "GET":
 * this CLI sends POST for reads (tavily/scholar search, screener, MCP
 * tools/list) *and* for writes (posting a tweet, minting a key, submitting a
 * video job). Retrying the second group posts twice, mints two keys, or bills
 * a second generation, so the default is one attempt and callers opt in.
 *
 * `chat` is deliberately left out of the opt-in even though a completion is
 * semantically a read: it is billed per call, and a response lost after the
 * server already produced it would charge the user twice. Better to let them
 * decide to send it again.
 *
 * The proper fix for that last case is an `Idempotency-Key` header the gateway
 * dedupes on (the Stripe model). That needs server-side support, so it is a
 * cross-repo change for later, not something to fake here.
 */

/** 1 initial attempt + 2 retries. At the observed ~1/3 transient failure rate
 *  this takes the odds of a command failing from ~33% to ~4%; a fourth attempt
 *  only reaches ~1% and makes every genuine failure slower to report. */
export const MAX_ATTEMPTS = 3;

/** Catalog, health and other /info reads — small payloads from a CDN edge. */
export const INFO_TIMEOUT_MS = 10_000;
/** A normal authenticated API call. */
export const DEFAULT_TIMEOUT_MS = 30_000;

const BASE_BACKOFF_MS = 300;
/** Agents fan out many calls at once; identical backoff would resynchronise
 *  them into a second wave against a gateway that is already struggling. */
const JITTER = 0.3;

/** Transient by nature: the request never reached a decision, or the server
 *  said it could not decide right now. 4xx is excluded on purpose — a bad key
 *  or a malformed parameter fails the same way every time. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export interface HttpOptions extends RequestInit {
  timeoutMs?: number;
  /** Opt in to retries. See the note above: this must mean "safe to send
   *  twice", not merely "does not modify anything". */
  idempotent?: boolean;
  /** Overrides MAX_ATTEMPTS; ignored unless idempotent. */
  maxAttempts?: number;
}

function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(3, attempt - 1); // 300, 900
  const spread = base * JITTER;
  return Math.round(base - spread + Math.random() * spread * 2);
}

/** Honour the server's own instruction when it gives one — it knows how
 *  overloaded it is far better than a fixed schedule does. Both the seconds
 *  and the HTTP-date forms are allowed by RFC 9110. */
function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Never wait longer than this on a Retry-After — a gateway asking for an hour
 *  should end the command, not silently park it. */
const MAX_RETRY_AFTER_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch with a timeout, and retries when the caller says it is safe.
 *
 * Throws the last error if every attempt failed at the network level; returns
 * the last Response if the failures were HTTP statuses, so callers keep their
 * existing error handling for 4xx/5xx bodies.
 */
export async function httpFetch(url: string, options: HttpOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, idempotent = false, maxAttempts, ...init } = options;
  const attempts = idempotent ? (maxAttempts ?? MAX_ATTEMPTS) : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (attempt === attempts || !RETRYABLE_STATUS.has(res.status)) return res;
      const after = retryAfterMs(res);
      if (after !== undefined && after > MAX_RETRY_AFTER_MS) return res;
      await sleep(after ?? backoffMs(attempt));
    } catch (e) {
      lastError = e;
      if (attempt === attempts) break;
      await sleep(backoffMs(attempt));
    }
  }
  throw asHelpfulError(lastError, url, attempts);
}

/**
 * `TypeError: fetch failed` is what undici reports for DNS failures, refused
 * connections, TLS errors and resets alike, and on its own it tells the user
 * nothing they can act on. Name the host, say how many attempts were made,
 * and keep the underlying cause attached.
 */
function asHelpfulError(cause: unknown, url: string, attempts: number): Error {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const err = cause as Error & { cause?: { code?: string } };
  const detail =
    err?.name === "TimeoutError" || err?.name === "AbortError"
      ? "timed out"
      : err?.cause?.code
        ? `${err.cause.code}`
        : (err?.message ?? "network error");
  const tries = attempts > 1 ? ` after ${attempts} attempts` : "";
  const wrapped = new Error(`Could not reach ${host}${tries} — ${detail}`);
  if (cause instanceof Error) wrapped.cause = cause;
  return wrapped;
}
