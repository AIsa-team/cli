import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const configUrl = pathToFileURL(resolve("dist/config.js")).href;
const homes: string[] = [];
const children: ChildProcess[] = [];
beforeAll(() => { if (!existsSync(resolve("dist/config.js"))) execFileSync("npx", ["tsc"], { stdio: "pipe" }); });
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function seed() {
  const home = mkdtempSync(join(tmpdir(), "aisa-concurrency-")); homes.push(home);
  mkdirSync(join(home, ".aisa"));
  writeFileSync(join(home, ".aisa/tokens.json"), JSON.stringify({ accessToken: "old", refreshToken: "refresh", expiresAt: 0, clientId: "client" }), { mode: 0o600 });
  return home;
}
function saved(home: string) { return JSON.parse(readFileSync(join(home, ".aisa/tokens.json"), "utf8")); }

function run(home: string, base: string, action: string) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config") };
  delete env.AISA_API_KEY;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import * as config from ${JSON.stringify(configUrl)};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => realFetch(${JSON.stringify(base)} + new URL(url).pathname, options);
    process.send({ type: "started" });
    try { const result = await (${action}); process.send({ type: "result", result }); }
    catch (e) { process.send({ type: "error", error: e.message }); process.exitCode = 1; }
  `], { env, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  children.push(child);
  let stderr = "";
  child.stderr!.on("data", (data) => { stderr += data; });
  let start!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  let answer: unknown;
  const result = new Promise<any>((resolve, reject) => {
    child.on("message", (message: any) => {
      if (message.type === "started") start();
      if (message.type === "result") answer = message.result;
      if (message.type === "error") reject(new Error(message.error));
    });
    child.on("error", reject);
    child.on("exit", (code) => { if (code === 0) resolve(answer); else reject(new Error(stderr || `child exit ${code}`)); });
  });
  return { child, started, result };
}

async function provider() {
  const calls: { path: string; body: URLSearchParams }[] = [];
  let release!: () => void;
  let first!: () => void;
  const firstRequest = new Promise<void>((resolve) => { first = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const server = createServer(async (req, res: ServerResponse) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    calls.push({ path: req.url!, body: new URLSearchParams(raw) });
    if (calls.length === 1) { first(); await gate; }
    if (req.url === "/oauth/token") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }));
    } else { res.writeHead(200); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, calls, firstRequest, release,
    close: () => { release(); server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); } };
}

describe("credential coordination across real CLI processes", () => {
  it("refreshes once and shares the new token with a concurrent 401 retry", async () => {
    const home = seed(), api = await provider();
    try {
      const first = run(home, api.base, "config.getAccessToken()");
      await api.firstRequest;
      const second = run(home, api.base, 'config.refreshAccessToken("old")');
      await second.started;
      api.release();
      expect(await Promise.all([first.result, second.result])).toEqual(["new", "new"]);
      expect(api.calls).toHaveLength(1);
      expect(saved(home).refreshToken).toBe("rotated");
    } finally { await api.close(); }
  });

  it.each(["logout", "replace"])("serializes refresh with %s and revokes the rotated credential", async (action) => {
    const home = seed(), api = await provider();
    try {
      const refresh = run(home, api.base, "config.getAccessToken()");
      await api.firstRequest;
      const change = run(home, api.base, action === "logout" ? "config.revokeAndClearTokens()" : 'config.replaceTokens("sk-replacement")');
      await change.started;
      api.release();
      await Promise.all([refresh.result, change.result]);
      expect(api.calls.map((c) => c.path)).toEqual(["/oauth/token", "/oauth/token/revoke"]);
      expect(api.calls[1].body.get("token")).toBe("rotated");
      if (action === "logout") expect(existsSync(join(home, ".aisa/tokens.json"))).toBe(false);
      else expect(saved(home)).toEqual({ accessToken: "sk-replacement" });
    } finally { await api.close(); }
  });

  it("does not let a waiting refresh resurrect a logged-out session", async () => {
    const home = seed(), api = await provider();
    try {
      const logout = run(home, api.base, "config.revokeAndClearTokens()");
      await api.firstRequest;
      const refresh = run(home, api.base, 'config.refreshAccessToken("old")');
      await refresh.started;
      api.release();
      expect(await logout.result).toBe(true);
      expect(await refresh.result).toBeUndefined();
      expect(api.calls).toHaveLength(1);
      expect(existsSync(join(home, ".aisa/tokens.json"))).toBe(false);
    } finally { await api.close(); }
  });

  it("serializes two new logins and retires both superseded grants", async () => {
    const home = seed(), api = await provider();
    try {
      const first = run(home, api.base, 'config.replaceTokens("first", "first-refresh", 9999999999999, "first-client")');
      await api.firstRequest;
      const second = run(home, api.base, 'config.replaceTokens("second", "second-refresh", 9999999999999, "second-client")');
      await second.started;
      api.release();
      await Promise.all([first.result, second.result]);
      expect(api.calls.map((call) => call.body.get("token"))).toEqual(["refresh", "first-refresh"]);
      expect(saved(home).refreshToken).toBe("second-refresh");
    } finally { await api.close(); }
  });

  it("recovers a stale lock left by a terminated process", async () => {
    const home = seed(), api = await provider();
    try {
      const lock = join(home, ".aisa/tokens.json.lock");
      mkdirSync(lock);
      const past = new Date(Date.now() - 60_000); utimesSync(lock, past, past);
      const refresh = run(home, api.base, "config.getAccessToken()");
      await api.firstRequest; api.release();
      expect(await refresh.result).toBe("new");
      expect(existsSync(lock)).toBe(false);
    } finally { await api.close(); }
  });
});
