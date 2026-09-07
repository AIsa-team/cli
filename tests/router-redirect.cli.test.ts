/**
 * Isolated compiled regression for fail-closed Router redirects.
 *
 * This file never stubs fetch. Cases run in a child `node dist/...` process so
 * vi.stubGlobal("fetch") from other suites cannot remain installed.
 * httpFetch already forwards RequestInit.redirect; the legacy helper default
 * is unchanged.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "index.js");

const BATCH = '{"calls":[{"call_id":"c1","tool":"t","arguments":{}}]}';
const COMMANDS: Array<{ args: string[]; path: string }> = [
  { args: ["search", "--json", "--input", '{"query":"x"}'], path: "/v1/tool-router/aisa-search-tool" },
  { args: ["schema", "--json", "--input", '{"tools":["t"]}'], path: "/v1/tool-router/aisa-batch-get-schema" },
  { args: ["quote", "--json", "--input", BATCH], path: "/v1/tool-router/aisa-batch-quote" },
  { args: ["call", "--json", "--input", BATCH], path: "/v1/tool-router/aisa-batch-use" },
];

beforeAll(() => {
  if (!existsSync(cli)) {
    execFileSync("npx", ["tsc"], { cwd: root, stdio: "pipe" });
  }
});

describe("compiled Router client refuses redirects", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("compiled aisa quote does not POST a 307 Location to aisa-batch-use", async () => {
    const hits: string[] = [];
    const { server, base } = await listen((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === "/v1/tool-router/aisa-batch-use") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"executed":true}');
        return;
      }
      res.writeHead(307, { location: "/v1/tool-router/aisa-batch-use" });
      res.end("redirected");
    });
    const home = mkdtempSync(join(tmpdir(), "aisa-cli-redir-"));
    homes.push(home);

    try {
      const ran = await runCompiledCli(["quote", "--json", "--input", BATCH], {
        HOME: home,
        AISA_API_KEY: "fake-local-key",
        AISA_ROUTER_BASE_URL: base,
      });
      expect(ran.status).toBe(1);
      expect(ran.stdout).toContain("redirected");
      expect(ran.stdout).not.toContain("executed");
      expect(hits).toEqual(["POST /v1/tool-router/aisa-batch-quote"]);
    } finally {
      await closeListen(server);
    }
  });

  it("compiled CLI does not follow /trap for search, schema, quote, or call", async () => {
    const hits: string[] = [];
    const { server, base } = await listen((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === "/trap") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"executed":true}');
        return;
      }
      res.writeHead(307, { location: "/trap" });
      res.end("redirected");
    });
    const home = mkdtempSync(join(tmpdir(), "aisa-cli-redir-"));
    homes.push(home);

    try {
      for (const command of COMMANDS) {
        hits.length = 0;
        const ran = await runCompiledCli(command.args, {
          HOME: home,
          AISA_API_KEY: "fake-local-key",
          AISA_ROUTER_BASE_URL: base,
        });
        expect(ran.status, command.args[0]).toBe(1);
        expect(ran.stdout, command.args[0]).toContain("redirected");
        expect(hits, command.args[0]).toEqual([`POST ${command.path}`]);
        expect(hits).not.toContain("POST /trap");
      }
    } finally {
      await closeListen(server);
    }
  });
});

function runCompiledCli(
  args: string[],
  extraEnv: NodeJS.ProcessEnv
): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; base: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("expected tcp address"));
        return;
      }
      resolve({ server, base: `http://127.0.0.1:${addr.port}` });
    });
    server.on("error", reject);
  });
}

function closeListen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
