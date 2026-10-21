import { BASE_URL } from "../constants.js";
import { httpFetch } from "./http.js";

/**
 * The credential a third-party client config gets.
 *
 * Since 0.6.0 browser login stores an OAuth session: this CLI refreshes the
 * access token, but a token copied into Claude Code, Codex or Cursor stays
 * the snapshot it was — and expires in 24 hours, taking every MCP entry and
 * model provider with it the next day. Those configs need an API key, so an
 * OAuth access token is traded for the durable "aisa cli" key at
 * /v1/keys/mint. The server returns the same managed key on every call, so
 * nothing piles up; the CLI's own session is left as it is.
 *
 * A static key (`login --key`, AISA_API_KEY) already is one and passes
 * through untouched — the mint endpoint refuses API keys anyway.
 */
const MINT_URL = `${BASE_URL}/v1/keys/mint`;

export async function clientConfigKey(credential: string): Promise<string> {
  if (credential.startsWith("sk-")) return credential;
  const res = await httpFetch(MINT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    // Named explicitly; no body means the same thing to the server.
    body: JSON.stringify({ client: "cli" }),
    timeoutMs: 20_000,
  });
  if (res.status === 404) {
    throw new Error(
      "this deployment cannot issue CLI keys — copy one from https://console.aisa.one/api-keys and run: aisa login --key <key>"
    );
  }
  const minted = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!res.ok || !minted.key) {
    throw new Error(`could not issue a key for your clients: ${minted.error ?? `HTTP ${res.status}`}`);
  }
  return minted.key;
}
