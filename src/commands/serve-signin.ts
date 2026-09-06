import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { renderSignInPage } from "./signin-page.js";

/**
 * Keeping the sign-in page up after the terminal has gone.
 *
 * A shell waits on the process it started, so the CLI cannot both return the
 * prompt and keep serving. Closing the socket the moment the code arrives is
 * what the CLI did, and it left a page that could not survive a refresh: the
 * user reloads to check it really worked, and the browser says the site
 * cannot be reached — which reads like the sign-in failed.
 *
 * So the page is handed over. The parent releases the port, starts a
 * detached copy of itself that serves that one page, and exits. The tab
 * keeps working on the same address because the child takes the same port.
 *
 * It holds nothing: one static document, no token, no state, no routes that
 * could change anything. The sign-in is already finished by the time this
 * exists.
 */

/** How long the page keeps answering after the terminal is handed back. */
export const SIGNIN_PAGE_TTL_MS = 5 * 60 * 1000;

/**
 * Hand the page to a process the shell is not waiting on.
 *
 * Returns false when the child could not be started, which the caller should
 * treat as "the page is going away" rather than pretending otherwise.
 */
export function handOverSignInPage(port: number, closeParent: () => void): boolean {
  const until = Date.now() + SIGNIN_PAGE_TTL_MS;
  // Release the port before the child reaches for it. The child retries
  // anyway — closing a listener is not instantaneous — but starting from a
  // freed port keeps the usual case to a single attempt.
  closeParent();
  try {
    const child = spawn(process.execPath, [process.argv[1], "__serve-signin", String(port), String(until)], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    // Unreferenced and in its own process group: the shell will not wait for
    // it, and Ctrl-C in the terminal it came from does not reach it.
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** The detached half: serve that one page until its deadline, then stop. */
export async function serveSignInAction(portArg: string, untilArg: string): Promise<void> {
  const port = Number(portArg);
  const until = Number(untilArg);
  if (!port || !until || until <= Date.now()) return;

  const srv = createServer((_req, res) => {
    res
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      })
      .end(renderSignInPage("ok", until));
  });

  // The parent has just closed its listener; a socket takes a moment to let
  // go, so keep asking rather than giving the page a dead port on the
  // strength of one failed attempt.
  for (let attempt = 0; attempt < 20; attempt++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = () => resolve(false);
      srv.once("error", onError);
      srv.listen(port, "127.0.0.1", () => {
        srv.off("error", onError);
        resolve(true);
      });
    });
    if (ok) break;
    if (attempt === 19) return;
    await new Promise((r) => setTimeout(r, 150));
  }

  const stop = setTimeout(() => {
    srv.close();
    process.exit(0);
  }, until - Date.now());
  // The timer alone keeps this alive; nothing else should.
  stop.unref?.();
  setTimeout(() => process.exit(0), until - Date.now() + 5_000);
}
