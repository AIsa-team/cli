import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, expect, it } from "vitest";

const cli = resolve("dist/index.js");
const homes: string[] = [];
beforeAll(() => { if (!existsSync(cli)) execFileSync("npx", ["tsc"], { stdio: "pipe" }); });
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });

it.each(["logout", "whoami", "mcp"])("reports %s credential failures without an unhandled rejection", (command) => {
  const home = mkdtempSync(join(tmpdir(), "aisa-auth-errors-"));
  homes.push(home);
  mkdirSync(join(home, ".aisa"));
  mkdirSync(join(home, ".cursor"));
  const tokenPath = join(home, ".aisa/tokens.json");
  // A real command subprocess, isolated credentials, and no external network.
  const stored = JSON.stringify(command === "logout"
    ? { accessToken: "access", refreshToken: "refresh", clientId: "client" }
    : { accessToken: "" });
  writeFileSync(tokenPath, stored, { mode: 0o600 });
  const args = command === "mcp" ? ["mcp", "setup", "--agent", "cursor"] : [command];
  const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, "config"), PATH: "", NO_COLOR: "1" };
  delete env.AISA_API_KEY;
  const bootstrap = join(home, "run.mjs");
  writeFileSync(bootstrap, `
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/oauth/token/revoke')) return new Response('', { status: 503 });
      return Response.json({ servers: [{ slug: 'web-search', status: 'live', transport: { endpoint: 'https://example.test/mcp' } }] });
    };
    await import(${JSON.stringify(pathToFileURL(cli).href)});
  `);
  const result = spawnSync(process.execPath, [bootstrap, ...args], { env, encoding: "utf8", timeout: 10_000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  const message = command === "logout"
    ? "OAuth revocation failed (HTTP 503). Credentials retained; retry the command."
    : "Invalid token file. Restore it before changing credentials.";
  expect(result.stderr.trim()).toBe(`Error: ${message}`);
  expect(readFileSync(tokenPath, "utf8")).toBe(stored);
});
