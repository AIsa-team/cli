import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderT2Page } from "./connect-t2.js";
import { isInstalled } from "./install.js";
import { renderDone } from "./connect.js";
import type { ClientInfo, RunState } from "./connect-shared.js";
import type { LiveServer } from "./mcp.js";
import type { Lang } from "./flow.js";

/**
 * Keeping the results page up after the terminal has been handed back.
 *
 * A shell waits on the process it started, so there is no way to return the
 * prompt and keep serving in the same one: the choice used to be the page or
 * the prompt, and picking Exit gave neither — the run said it was handing the
 * terminal back and then sat on it for half an hour.
 *
 * So the page is handed over instead. The foreground process writes down what
 * the page needs, starts a detached copy of itself that serves only that, and
 * exits. The browser tab keeps working on the same URL because the child
 * takes the same port, which the parent has just released.
 *
 * The child holds no state of its own and does nothing but answer: no MCP
 * writes, no installs, no apply route. Whatever the run did is already done.
 */

/** Where a detached results server writes down that it exists. */
export function resultsPidPath(): string {
  return join(tmpdir(), "aisa-connect-results.json");
}

/**
 * Close a results page left over from an earlier run.
 *
 * Called at the start of every `connect`: the new run is what the user is
 * looking at now, and an older page still answering on some port only invites
 * reading a result that no longer describes this machine.
 */
export function closeStaleResults(): void {
  let rec: { pid?: number; until?: number };
  try {
    rec = JSON.parse(readFileSync(resultsPidPath(), "utf-8"));
  } catch {
    return;
  }
  try {
    if (rec.pid) process.kill(rec.pid, "SIGTERM");
  } catch {
    /* already gone, which is the same outcome */
  }
  try {
    unlinkSync(resultsPidPath());
  } catch {
    /* nothing to remove */
  }
}

/** Everything the done page needs, and nothing else. */
export interface ResultsHandover {
  port: number;
  token: string;
  template: "t1" | "t2";
  lang: Lang;
  keyed: boolean;
  canInstall: boolean;
  servers: LiveServer[];
  clients: ClientInfo[];
  chosenServers: LiveServer[];
  chosenClients: string[];
  state: RunState;
  /** Absolute epoch ms; the child stops serving at this point. */
  until: number;
}

/**
 * Hand the page to a process that outlives this terminal.
 *
 * Returns false when the handover could not be started, which the caller
 * should treat as "the page is closing" rather than pretending otherwise.
 */
export function handOverResults(h: ResultsHandover, closeParent: () => void): boolean {
  let file: string;
  try {
    file = join(mkdtempSync(join(tmpdir(), "aisa-results-")), "handover.json");
    writeFileSync(file, JSON.stringify(h), { mode: 0o600 });
  } catch {
    return false;
  }

  // Release the port before the child reaches for it. The child retries
  // anyway — closing a listener is not instantaneous — but starting from a
  // freed port keeps the usual case to a single attempt.
  closeParent();

  try {
    const child = spawn(process.execPath, [process.argv[1], "__serve-results", file], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    // Unreferenced and in its own process group: the shell will not wait for
    // it, and Ctrl-C in the terminal it came from does not reach it.
    child.unref();
    // Leave its pid where the next run will look. A results server is not a
    // run — it cannot apply anything — so it must never block one; but a new
    // `aisa connect` supersedes it, and two pages on one machine showing
    // different runs is worse than one that has closed.
    try {
      writeFileSync(resultsPidPath(), JSON.stringify({ pid: child.pid, port: h.port, until: h.until }), {
        mode: 0o600,
      });
    } catch {
      /* the child still runs; it just outlives its own record */
    }
    return true;
  } catch {
    try {
      unlinkSync(file);
    } catch {
      /* nothing to clean up */
    }
    return false;
  }
}

/** Wait for the port the parent just gave up. */
async function listenWithRetry(
  srv: ReturnType<typeof createServer>,
  port: number
): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = () => resolve(false);
      srv.once("error", onError);
      srv.listen(port, "127.0.0.1", () => {
        srv.off("error", onError);
        resolve(true);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/**
 * The detached half: serve the done page until its deadline, then stop.
 *
 * Read-only by construction — the routes that change a machine are simply not
 * here, so a page left open cannot start anything.
 */
export async function serveResultsAction(file: string): Promise<void> {
  let h: ResultsHandover;
  try {
    h = JSON.parse(readFileSync(file, "utf-8")) as ResultsHandover;
  } catch {
    return;
  }
  try {
    unlinkSync(file);
  } catch {
    /* it served its purpose either way */
  }

  const remaining = h.until - Date.now();
  if (remaining <= 0) return;

  const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const tokenOk =
      url.searchParams.get("token") === h.token || req.headers["x-connect-token"] === h.token;
    if (!tokenOk) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(h.state));
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/done")) {
      const body =
        h.template === "t2"
          ? renderT2Page(h.servers, h.clients, h.token, h.keyed, h.canInstall, !isInstalled("aisa"), "done", h.lang)
          : renderDone(
              h.chosenServers,
              h.chosenClients,
              h.state.steps,
              h.servers,
              h.state.balanceMicros ?? null,
              h.state.llmMode
            );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
      return;
    }
    // Everything that could change this machine is absent, not refused: there
    // is no apply, no launch, no select. A tab left open overnight can only
    // read what already happened.
    res.writeHead(404).end();
  });

  if (!(await listenWithRetry(srv, h.port))) return;

  const forget = () => {
    try {
      const rec = JSON.parse(readFileSync(resultsPidPath(), "utf-8")) as { pid?: number };
      if (rec.pid === process.pid) unlinkSync(resultsPidPath());
    } catch {
      /* someone else's record, or none */
    }
  };
  process.on("exit", forget);
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      forget();
      process.exit(0);
    });
  }

  const stop = setTimeout(() => {
    srv.close();
    process.exit(0);
  }, remaining);
  // The timer alone keeps this alive; nothing else should.
  stop.unref?.();
  setTimeout(() => process.exit(0), remaining + 5_000);
}
