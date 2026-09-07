import { apiRequestRaw } from "../api.js";

/**
 * Does the stored key still work?
 *
 * `connect` used to ask only whether a key existed, and a key that exists is
 * not a key that works: one revoked from the console, or belonging to an
 * account that was deleted, sits in ~/.aisa/key looking exactly like a good
 * one. The run then skipped the sign-in step, wrote that dead key into every
 * MCP entry and into the agent's provider settings, and the first thing the
 * user saw was their agent failing to authenticate — long after the setup had
 * declared itself finished.
 *
 * Three answers, not two. "Cannot tell" has to be its own verdict: a laptop
 * on a flaky connection must not be told its key is bad and pushed through a
 * sign-in it does not need. The retries that separate the two are already in
 * httpFetch — an idempotent GET is attempted three times with backoff, and
 * 401/403 are deliberately not retryable because a rejected key does not
 * become accepted on the second ask.
 */
export type KeyVerdict = "ok" | "invalid" | "unreachable";

/** Small: this runs while the user is watching, not in the background. */
const TIMEOUT_MS = 8_000;

export async function verifyKey(key: string | undefined): Promise<KeyVerdict> {
  if (!key) return "invalid";
  try {
    const res = await apiRequestRaw(key, "credits/balance", {
      idempotent: true,
      timeoutMs: TIMEOUT_MS,
    });
    if (res.ok) return "ok";
    // The gateway rejected the credential itself. Nothing about the network
    // would change this answer.
    if (res.status === 401 || res.status === 403) return "invalid";
    return "unreachable";
  } catch {
    // Every attempt failed at the network level. The key may well be fine.
    return "unreachable";
  }
}
