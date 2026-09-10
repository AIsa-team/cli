import chalk from "chalk";
import { run } from "../utils/exec.js";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { error, hint, info, success } from "../utils/display.js";
import { setApiKey } from "../config.js";
import { maskKey } from "../config.js";
import { httpFetch } from "../utils/http.js";
import { canOpenBrowser } from "../utils/browser.js";
import { SIGNIN, t, type Lang } from "./flow.js";
import { renderSignInPage } from "./signin-page.js";
import { handOverSignInPage, SIGNIN_PAGE_TTL_MS } from "./serve-signin.js";

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
 * A machine with no browser of its own takes the paste-back variant, and it
 * is chosen for the user rather than asked for: the URL is printed, the user
 * authorizes wherever they are sitting, the redirect to 127.0.0.1 fails to
 * load there — and that is fine, because the code is in the URL, which they
 * paste back here. PKCE needs the verifier, not a reachable callback, and
 * the verifier never left this machine. What travels through the clipboard
 * is a one-time code, not a key.
 */

const AUTH_SERVER = "https://clerk.aisa.one";
/**
 * Where the sign-in lands when the browser is on a different machine.
 *
 * A page that does one thing: show the one-time code so it can be carried
 * back by hand. The loopback redirect below is better whenever it can be
 * used — the CLI catches the code itself and nobody copies anything — but it
 * only works when the browser and this process share a machine.
 *
 * This address is a published contract. Every released CLI that names it
 * keeps sending users there, so it is not to be changed; a new one would
 * have to be added alongside.
 */
const HOSTED_REDIRECT = "https://aisa.one/cli/auth";
const MINT_URL = "https://api.aisa.one/v1/keys/mint";

const b64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function registerClient(redirectUri: string): Promise<string> {
  const res = await httpFetch(`${AUTH_SERVER}/oauth/register`, {
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
/**
 * How long to hold a loopback callback open before giving up on it.
 *
 * Five minutes looked generous until a sign-in took longer than that and the
 * approval landed on a closed port: the browser said it could not connect,
 * which reads as "I broke something" rather than "that took too long". A
 * person who is signing in normally is done inside a minute; the ones who are
 * not are switching machines, reading the consent screen properly, or being
 * interrupted. Fifteen minutes costs nothing and covers all of them.
 */
const CALLBACK_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * And once it does expire, keep answering for a little longer.
 *
 * The wait is over and the terminal has said so, but the socket costs nothing
 * to hold and an approval arriving late deserves a sentence rather than a
 * connection error. It stops the process from lingering more than this.
 */
const AFTER_TIMEOUT_GRACE_MS = 90 * 1000;

function waitForCallback(port: number, expectedState: string, lang: Lang): Promise<string> {
  let expired = false;
  return new Promise((resolve, reject) => {
    // A browser we opened may never come back — it was never opened at all,
    // the tab was closed, the machine has no screen. Waiting for that with
    // no deadline is a hang, and a hang is the one failure that tells the
    // user nothing.
    const giveUp = setTimeout(() => {
      // Deliberately not closing the server: an approval that arrives now has
      // to land somewhere that can explain itself. It closes on its own a
      // little later, and the process does not outlive it.
      expired = true;
      const close = setTimeout(() => {
        srv.close();
        process.exit(1);
      }, AFTER_TIMEOUT_GRACE_MS);
      close.unref?.();
      reject(
        new Error(
          `no response from the browser after ${CALLBACK_TIMEOUT_MS / 60_000} minutes — run 'aisa login' again`
        )
      );
    }, CALLBACK_TIMEOUT_MS);
    giveUp.unref?.();
    const srv = createServer((req, res) => {
      clearTimeout(giveUp);
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (expired) {
        // They approved it; we had already stopped listening for an answer.
        // Saying so is the difference between "that took too long" and the
        // browser's own "could not connect", which reads like a broken tool.
        res
          .writeHead(408, { "content-type": "text/html; charset=utf-8" })
          .end(renderSignInPage("expired"));
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || state !== expectedState) {
        res
          .writeHead(400, { "content-type": "text/html; charset=utf-8" })
          .end(renderSignInPage("failed"));
        srv.close();
        reject(new Error("authorization was denied or the response was malformed"));
        return;
      }
      // charset matters more than it looks: without it a browser in a Chinese
      // locale decodes this as GBK and the em dash arrives as mojibake, which
      // is what the last version of this line actually did.
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(renderSignInPage("ok", Date.now() + SIGNIN_PAGE_TTL_MS));
      // Not srv.close(): a page that cannot survive a refresh is a page that
      // says "this site can't be reached" to someone checking their sign-in
      // really worked. The port goes to a detached copy that serves this one
      // document for a few minutes, and the terminal comes back now.
      res.on("finish", () => {
        clearTimeout(giveUp);
        handOverSignInPage(port, () => srv.close());
      });
      resolve(code);
    });
    srv.listen(port, "127.0.0.1");
    srv.on("error", (e) => {
      clearTimeout(giveUp);
      reject(e);
    });
  });
}

/** The paste-back path: read the redirect URL (or bare code) from stdin. */
/**
 * Read the redirect back from whoever has the browser.
 *
 * Takes the whole address, which is what a person copying from an address
 * bar actually has — but also takes a bare code, because someone who reads
 * the query string will pull out the interesting part instead, and refusing
 * that would be pedantry.
 */
/**
 * Read the pasted redirect, and give the reader more than one go at it.
 *
 * It used to ask once and reject on anything it could not parse. Pasting a
 * long code into a terminal is exactly where people fumble — the clipboard
 * did not take, enter went in early, the wrong window was in front — and one
 * fumble failed the whole sign-in. In `aisa login` that costs the command and
 * the authorize URL together: the page they just opened is stale, so they
 * start over from the beginning for a mistyped paste.
 *
 * Three tries, each saying what was wrong with the last one. An empty line is
 * not a mistake, it is "stop asking" — the same meaning it has in every other
 * prompt in this flow.
 */
const PASTE_TRIES = 3;

function parsePaste(raw: string): { code: string | null; state: string | null } {
  const text = raw.trim().replace(/^["']|["']$/g, "");
  try {
    const url = new URL(text);
    return { code: url.searchParams.get("code"), state: url.searchParams.get("state") };
  } catch {
    // Not a URL. A query fragment, or the code on its own.
    const params = new URLSearchParams(text.replace(/^\?/, ""));
    return {
      code: params.get("code") ?? (/^[A-Za-z0-9._~-]{8,}$/.test(text) ? text : null),
      state: params.get("state"),
    };
  }
}

async function waitForPaste(expectedState: string, lang: Lang): Promise<string> {
  for (let attempt = 1; attempt <= PASTE_TRIES; attempt++) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(t(SIGNIN.prompt, lang));
    rl.close();
    if (answer.trim() === "") {
      throw new Error("sign-in cancelled — run it again when you have the code");
    }
    const { code, state } = parsePaste(answer);
    let wrong: string | undefined;
    if (!code) wrong = t(SIGNIN.badPaste, lang);
    // A pasted bare code carries no state to check; a pasted URL does, and a
    // mismatched one is an older sign-in that would fail confusingly at the
    // token endpoint instead of here.
    else if (state !== null && state !== expectedState) {
      wrong = "that is from an older sign-in — paste the address from the page you just opened";
    }
    if (!wrong) return code as string;
    if (attempt === PASTE_TRIES) throw new Error(wrong);
    console.log(`  ${chalk.yellow(wrong)}`);
    console.log(`  ${chalk.gray(`try again — ${PASTE_TRIES - attempt} left, or press enter to stop`)}\n`);
  }
  /* c8 ignore next */
  throw new Error(t(SIGNIN.badPaste, lang));
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  void run(cmd, [url], { timeout: 30_000 }).catch(() => {});
}

/**
 * The whole sign-in, as a function other commands can embed: browser (or
 * paste-back) OAuth, then the mint. Stores the key and returns it; throws on
 * any failure. `aisa login` wraps this with CLI messaging; `aisa connect`
 * runs it as its "Sign in to AIsa" step.
 */
/**
 * Somewhere for the browser to land.
 *
 * `aisa login` on its own takes a random loopback port and serves one page on
 * it. Inside `connect` that is the wrong shape: the sign-in opens in a second
 * tab, and a random port has nothing to do with the run — the tab finishes on
 * a page that knows nothing about the setup in progress and leaves the user
 * to find their way back to the first tab themselves. Handing the run's own
 * server in means the approval comes home to the address the setup already
 * lives at, and the tab can return the reader to it.
 */
export interface OAuthCatcher {
  /** Registered with the authorization server before the browser opens. */
  redirectUri: string;
  /** Resolves with the authorization code, or rejects with why it will not. */
  wait(expectedState: string): Promise<string>;
}

export async function mintCliKey(
  options: { open?: boolean; lang?: Lang; catcher?: OAuthCatcher } = {}
): Promise<string> {
  const lang: Lang = options.lang ?? "en";
  // Unset means "work it out": a server has no browser to open and waiting
  // for a click on a machine with no screen is the worst way to find out.
  // A caller that brought its own catcher has already decided.
  const useBrowser = options.catcher ? true : (options.open ?? canOpenBrowser());

  // The redirect has to be registered before the browser opens, and Clerk
  // matches it exactly — so which of the three it is has to be settled here,
  // before anything else happens. A loopback port is only worth taking when
  // this process is the one that will catch the redirect.
  const port = useBrowser && !options.catcher ? 10000 + Math.floor(Math.random() * 50_000) : 0;
  const redirectUri = options.catcher
    ? options.catcher.redirectUri
    : useBrowser
      ? `http://127.0.0.1:${port}/callback`
      : HOSTED_REDIRECT;

  info(t(SIGNIN.start, lang));
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
  if (options.catcher) {
    // The run's own server is already listening; nothing to start here.
    info(t(SIGNIN.willOpen, lang));
    console.log(`  ${t(SIGNIN.ifNot, lang)}\n  ${authUrl.toString()}\n`);
    openBrowser(authUrl.toString());
    code = await options.catcher.wait(state);
  } else if (useBrowser) {
    info(t(SIGNIN.willOpen, lang));
    console.log(`  ${t(SIGNIN.ifNot, lang)}\n  ${authUrl.toString()}\n`);
    openBrowser(authUrl.toString());
    code = await waitForCallback(port, state, lang);
  } else {
    if (!process.stdin.isTTY) {
      // Nothing to open and nowhere to paste. Say so now rather than sitting
      // on a callback that cannot arrive.
      throw new Error(
        `no browser here and no terminal to paste into — sign in on a machine that has one, or run: aisa login --key <key>\n  ${authUrl.toString()}`
      );
    }
    console.log(`  ${t(SIGNIN.here, lang)}\n`);
    console.log(`  ${t(SIGNIN.step1, lang)}\n     ${authUrl.toString()}\n`);
    console.log(`  ${t(SIGNIN.step2, lang)}\n`);
    console.log(`  ${t(SIGNIN.step3, lang)}\n`);
    code = await waitForPaste(state, lang);
  }

  const tokenRes = await httpFetch(`${AUTH_SERVER}/oauth/token`, {
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
  const mintRes = await httpFetch(MINT_URL, {
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

/** Commander after-help for `aisa login`. Mechanics only; runtime is unchanged. */
export function loginHelpAfter(): string {
  return `
Default: open a browser this person can actually use (SSH/CI/no display skip the local open). The live authorize URL is printed at the same time — relay that exact URL immediately. Do not invent, shorten, or delay it.

--no-browser needs a persistent interactive TTY. Agents request only the one-time redirect URL or code — never an API key, access token, or refresh token. Paste that result into this same living process once. "Done" is not that input. If they cannot type here, relay the paste through chat into this PTY. An empty line cancels.

If this process already timed out, or the URL/code is from an older run, start a fresh aisa login and use the new URL and its result. Do not reuse a stale paste.

No browser and no TTY: this CLI cannot complete OAuth here. Normal setup is native MCP OAuth at https://tools.aisa.one/mcp.

Do not report connected unless login stored a key and the following balance check succeeded. aisa whoami and a stored local key are not proof. Scripts/CI: AISA_API_KEY or --key.
`;
}

export async function oauthLogin(options: { open?: boolean; lang?: Lang } = {}): Promise<void> {
  if (options.open === false && !process.stdin.isTTY) {
    error("--no-browser needs an interactive terminal to paste the redirect URL into.");
    hint("In scripts, use: aisa login --key <key>");
    process.exitCode = 1;
    return;
  }
  const key = await mintCliKey(options);
  // The balance follows from the caller, so no "try aisa balance" here: being
  // told to go and check is worse than being shown.
  success(`Signed in — CLI key ${maskKey(key)} stored`);
}
