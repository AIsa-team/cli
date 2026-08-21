import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { error, hint, info, success } from "../utils/display.js";
import { setApiKey } from "../config.js";
import { maskKey } from "../config.js";

/**
 * `aisa login` without a key: sign in once in a browser, come back with the
 * CLI's long-lived key.
 *
 * The flow is the standard one every CLI converges on (gh, flyctl, claude):
 *
 *   1. register a public OAuth client (Clerk supports dynamic registration)
 *   2. authorization-code + PKCE, redirecting to a loopback port
 *   3. exchange the code for an access token
 *   4. trade that token for the durable "aisa cli" key at /v1/keys/mint,
 *      and store the key — the token itself is then dropped. One secret on
 *      disk, and it is the one that does not expire in a day.
 *
 * Headless machines get the paste-back variant (--no-browser): the URL is
 * printed, the user authorizes on any machine, the redirect to 127.0.0.1
 * fails to load there — and that is fine, because the code is in the URL,
 * which the user pastes back here. PKCE needs the verifier, not a reachable
 * callback.
 */

const AUTH_SERVER = "https://clerk.aisa.one";
const MINT_URL = "https://api.aisa.one/v1/keys/mint";

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function registerClient(redirectUri: string): Promise<string> {
  const res = await fetch(`${AUTH_SERVER}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "AIsa CLI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "openid profile email",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error(`client registration failed (HTTP ${res.status})`);
  return body.client_id;
}

/** Wait for the authorization code on the loopback port. */
function waitForCallback(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || state !== expectedState) {
        res.writeHead(400, { "content-type": "text/html" }).end("<h3>Sign-in failed — return to the terminal.</h3>");
        srv.close();
        reject(new Error("authorization was denied or the response was malformed"));
        return;
      }
      res
        .writeHead(200, { "content-type": "text/html" })
        .end("<h3>Signed in — you can close this tab and return to the terminal.</h3>");
      srv.close();
      resolve(code);
    });
    srv.listen(port, "127.0.0.1");
    srv.on("error", reject);
  });
}

/** The paste-back path: read the redirect URL (or bare code) from stdin. */
function waitForPaste(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Paste the full redirect URL from your browser: ", (answer) => {
      rl.close();
      try {
        const url = new URL(answer.trim());
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code) throw new Error("no code in that URL");
        if (state !== expectedState) throw new Error("state mismatch — paste the URL from this sign-in, not an older one");
        resolve(code);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url], () => {});
}

/**
 * The whole sign-in, as a function other commands can embed: browser (or
 * paste-back) OAuth, then the mint. Stores the key and returns it; throws on
 * any failure. `aisa login` wraps this with CLI messaging; `aisa connect`
 * runs it as its "Sign in to AIsa" step.
 */
export async function mintCliKey(options: { open?: boolean } = {}): Promise<string> {
  const useBrowser = options.open !== false;

  // Loopback port first: the redirect URI has to be registered before the
  // browser opens, and Clerk requires an exact match.
  const port = 10000 + Math.floor(Math.random() * 50_000);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  info("Signing in to AIsa…");
  const clientId = await registerClient(redirectUri);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const authUrl = new URL(`${AUTH_SERVER}/oauth/authorize`);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  let code: string;
  if (useBrowser) {
    info("Your browser will open — approve the sign-in there.");
    console.log(`  If it does not open, visit:\n  ${authUrl.toString()}\n`);
    openBrowser(authUrl.toString());
    code = await waitForCallback(port, state);
  } else {
    console.log(`  Open this URL on any machine and sign in:\n  ${authUrl.toString()}\n`);
    console.log("  The browser will end on a 127.0.0.1 page that fails to load — that is expected.");
    code = await waitForPaste(state);
  }

  const tokenRes = await fetch(`${AUTH_SERVER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const tokens = (await tokenRes.json()) as TokenResponse;
  if (!tokens.access_token) {
    throw new Error(`token exchange failed: ${tokens.error_description ?? tokens.error ?? tokenRes.status}`);
  }

  // The token is a day-long credential; the key is the durable one. Trade up
  // and keep only the key.
  const mintRes = await fetch(MINT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (mintRes.status === 404) {
    // A deployment without the mint endpoint. The sign-in still proved the
    // account works; the key just has to travel by hand once.
    throw new Error(
      "this deployment cannot issue CLI keys — copy one from https://console.aisa.one/api-keys and run: aisa login --key <key>"
    );
  }
  const minted = (await mintRes.json()) as { key?: string; error?: string };
  if (!mintRes.ok || !minted.key) {
    throw new Error(`could not issue a key: ${minted.error ?? `HTTP ${mintRes.status}`}`);
  }

  setApiKey(minted.key);
  return minted.key;
}

export async function oauthLogin(options: { open?: boolean } = {}): Promise<void> {
  if (options.open === false && !process.stdin.isTTY) {
    error("--no-browser needs an interactive terminal to paste the redirect URL into.");
    hint("In scripts, use: aisa login --key <key>");
    process.exitCode = 1;
    return;
  }
  const key = await mintCliKey(options);
  success(`Signed in — CLI key ${maskKey(key)} stored`);
  hint("Try: aisa balance");
}
