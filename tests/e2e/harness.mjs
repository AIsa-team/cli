#!/usr/bin/env node
// DEFAULT-OFF Mock E2E：编译后的 CLI 对照真实 Router HTTP / MCP（共用 toolrouter.Service）。
// 不伪造整段 Router HTTP 响应；只替身本地 AIsaServices。基线在新命令落地前允许 CLI RED。

import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const pin = readFileSync(join(here, "router.pin"), "utf8").trim();
const overlaySrc = join(here, "router-overlay/cmd/parity-router");
const fixturesDir = join(here, "fixtures");

const args = parseArgs(process.argv.slice(2));
const snapshot =
  process.env.AISA_ROUTER_SNAPSHOT ||
  "/tmp/aisa-cli-mcp-audit.h2pKoy/router";
const routerRepo = process.env.AISA_ROUTER_REPO || "";

function parseArgs(argv) {
  const out = { cli: process.env.AISA_CLI || "", skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cli") out.cli = argv[++i] || "";
    else if (argv[i] === "--skip-build") out.skipBuild = true;
  }
  return out;
}

function log(message) {
  console.error(message);
}

class InfraError extends Error {
  constructor(message) {
    super(message);
    this.name = "InfraError";
  }
}

function failInfra(message) {
  throw new InfraError(message);
}

function parseLossless(text) {
  const protectedText = String(text).replace(
    /"(estimated_cost_micros_usd|max_cost_micros_usd|customer_cost_micros_usd)"\s*:\s*(-?\d+)/g,
    '"$1":"$2"'
  );
  return JSON.parse(protectedText);
}

function wipeVolatile(value) {
  if (Array.isArray(value)) return value.map(wipeVolatile);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "search_id" || key === "batch_id" || key === "request_id") {
        out[key] = `<${key}>`;
        continue;
      }
      out[key] = wipeVolatile(child);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function hasPrecisionToken(text) {
  return /"estimated_cost_micros_usd"\s*:\s*9007199254740993/.test(text);
}

function httpCall(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolvePromise({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20_000, () => {
      req.destroy(new Error(`timeout ${url}`));
    });
    if (body) req.write(body);
    req.end();
  });
}

async function routerHTTP(baseURL, path, { auth, body, requestId }) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (requestId) headers["x-request-id"] = requestId;
  return httpCall(`${baseURL}${path}`, {
    method: "POST",
    headers,
    body,
  });
}

async function mcpCall(baseURL, name, argumentsObject, { auth, requestId } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
    "mcp-method": "tools/call",
    "mcp-name": name,
  };
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (requestId) headers["x-request-id"] = requestId;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: "parity",
    method: "tools/call",
    params: { name, arguments: argumentsObject },
  });
  const res = await httpCall(`${baseURL}/mcp`, { method: "POST", headers, body: payload });
  let envelope;
  try {
    envelope = JSON.parse(res.body);
  } catch {
    return { status: res.status, raw: res.body, error: `mcp non-json: ${res.body.slice(0, 200)}` };
  }
  if (envelope.error) {
    return { status: res.status, raw: res.body, rpcError: envelope.error };
  }
  const result = envelope.result || {};
  const text = Array.isArray(result.content)
    ? result.content.find((item) => item && (item.type === "text" || item.text))?.text
    : undefined;
  const structured = result.structuredContent;
  // 工具错误时 text 常是纯消息；应用层 JSON 在 structuredContent。
  const rawApp = mcpApplicationRaw(text, structured, res.body);
  return {
    status: res.status,
    isError: Boolean(result.isError),
    raw: rawApp,
    structured,
  };
}

function mcpApplicationRaw(text, structured, fallback) {
  if (typeof text === "string" && looksLikeJsonObject(text)) return text;
  if (typeof structured === "string" && looksLikeJsonObject(structured)) return structured;
  if (structured != null) return JSON.stringify(structured);
  if (typeof text === "string" && text.trim()) return text;
  return fallback;
}

function looksLikeJsonObject(text) {
  const trimmed = String(text).trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function resolveCli(cliFlag) {
  if (cliFlag) {
    const path = isAbsolute(cliFlag) ? cliFlag : resolve(process.cwd(), cliFlag);
    if (!existsSync(path)) failInfra(`CLI not found: ${path}`);
    return path;
  }
  const built = join(repoRoot, "dist/index.js");
  if (!existsSync(built) && !args.skipBuild) {
    log("dist/index.js missing; running npm ci && npm run build");
    const ci = spawnSync("npm", ["ci"], { cwd: repoRoot, stdio: "inherit" });
    if (ci.status !== 0) failInfra("npm ci failed");
    const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
    if (build.status !== 0) failInfra("npm run build failed");
  }
  if (!existsSync(built)) failInfra("pass --cli PATH to a built CLI (dist/index.js missing)");
  return built;
}

function isolatedCliEnv({ home, xdg, tmp, baseURL, apiKey }) {
  // 不继承父进程 AISA_* / 用户 Conf。两个 Router 别名都钉到本机 overlay，避免打到生产。
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: xdg.config,
    XDG_DATA_HOME: xdg.data,
    XDG_STATE_HOME: xdg.state,
    XDG_CACHE_HOME: xdg.cache,
    TMPDIR: tmp,
    AISA_ROUTER_URL: baseURL,
    AISA_ROUTER_BASE_URL: baseURL,
  };
  if (apiKey) env.AISA_API_KEY = apiKey;
  return env;
}

function prepareIsolation(work) {
  const home = mkdtempSync(join(work, "home-"));
  const xdg = {
    config: join(work, "xdg-config"),
    data: join(work, "xdg-data"),
    state: join(work, "xdg-state"),
    cache: join(work, "xdg-cache"),
  };
  const tmp = join(work, "tmp");
  for (const dir of [
    xdg.config,
    xdg.data,
    xdg.state,
    xdg.cache,
    tmp,
    join(home, ".aisa"),
    join(home, "Library", "Preferences"),
    join(xdg.config, "aisa-cli-nodejs"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  return { home, xdg, tmp };
}

function assertConfigIsolated(isolation, baseURL) {
  const env = isolatedCliEnv({ ...isolation, baseURL, apiKey: undefined });
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      "const os=require('os'); const path=require('path'); const home=os.homedir(); const xdg=process.env.XDG_CONFIG_HOME||''; const darwin=path.join(home,'Library','Preferences','aisa-cli-nodejs'); const linux=xdg?path.join(xdg,'aisa-cli-nodejs'):''; process.stdout.write(JSON.stringify({home,xdg,darwin,linux,platform:process.platform}));",
    ],
    { cwd: repoRoot, env, encoding: "utf8" }
  );
  if (probe.status !== 0) {
    failInfra(`isolation probe failed: ${probe.stderr || probe.error}`);
  }
  let info;
  try {
    info = JSON.parse(probe.stdout);
  } catch {
    failInfra(`isolation probe produced non-json: ${probe.stdout}`);
  }
  if (!String(info.home).startsWith(isolation.home)) {
    failInfra(`os.homedir leaked to ${info.home}; expected under ${isolation.home}`);
  }
  if (info.xdg !== isolation.xdg.config) {
    failInfra(`XDG_CONFIG_HOME leaked to ${info.xdg}`);
  }
  const confPath = info.platform === "darwin" ? info.darwin : info.linux;
  if (!String(confPath).startsWith(isolation.home) && !String(confPath).startsWith(isolation.xdg.config)) {
    failInfra(`Conf path leaked to ${confPath}`);
  }
  log(`isolation home=${info.home} xdg=${info.xdg} conf=${confPath}`);
}

function cliCommand(cliPath, argv, { isolation, baseURL, apiKey, stdin } = {}) {
  const isJs = cliPath.endsWith(".js") || cliPath.endsWith(".mjs");
  const command = isJs ? process.execPath : cliPath;
  const commandArgs = isJs ? [cliPath, ...argv] : argv;
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: isolatedCliEnv({ ...isolation, baseURL, apiKey }),
    encoding: "utf8",
    input: stdin,
    timeout: 20_000,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : "",
  };
}

function classifyCli(result) {
  const text = `${result.stderr}\n${result.stdout}\n${result.error}`;
  if (/unknown command/i.test(text)) return "cli_command_missing";
  if (/unknown option/i.test(text)) return "cli_option_missing";
  if (/No API key found/i.test(text)) return "cli_required_key";
  return "ran";
}

function prepareRouterTree() {
  const work = mkdtempSync(join(tmpdir(), "aisa-cli-mcp-parity-"));
  try {
    const src = join(work, "router");
    if (existsSync(join(snapshot, ".git")) || existsSync(join(snapshot, "go.mod"))) {
      const clone = spawnSync("git", ["clone", "--local", "--quiet", snapshot, src], {
        encoding: "utf8",
      });
      if (clone.status !== 0) {
        failInfra(`git clone --local snapshot failed: ${clone.stderr || clone.stdout}`);
      }
    } else if (routerRepo) {
      const clone = spawnSync("git", ["clone", "--quiet", routerRepo, src], { encoding: "utf8" });
      if (clone.status !== 0) {
        failInfra(`git clone AISA_ROUTER_REPO failed: ${clone.stderr || clone.stdout}`);
      }
    } else {
      failInfra(
        `Router snapshot missing at ${snapshot}. Set AISA_ROUTER_SNAPSHOT or AISA_ROUTER_REPO.`
      );
    }
    const head = spawnSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (head.status !== 0) failInfra("router git rev-parse failed");
    const current = head.stdout.trim();
    if (current !== pin) {
      const checkout = spawnSync("git", ["-C", src, "checkout", "-q", pin], { encoding: "utf8" });
      if (checkout.status !== 0) {
        failInfra(`cannot checkout pinned ${pin} (was ${current}): ${checkout.stderr}`);
      }
    }
    const verified = spawnSync("git", ["-C", src, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (verified.stdout.trim() !== pin) failInfra(`router HEAD ${verified.stdout.trim()} != pin ${pin}`);
    cpSync(overlaySrc, join(src, "cmd/parity-router"), { recursive: true });
    const binary = join(work, "parity-router");
    const build = spawnSync(
      "go",
      ["build", "-o", binary, "./cmd/parity-router"],
      { cwd: src, encoding: "utf8", env: { ...process.env, GOTOOLCHAIN: "go1.26.0" } }
    );
    if (build.status !== 0) {
      failInfra(`go build parity-router failed:\n${build.stderr || build.stdout}`);
    }
    return { work, src, binary };
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

function startOverlay(binary) {
  return new Promise((resolvePromise, reject) => {
    // 直接跑编译产物，避免 go run 留下无法随 wrapper 退出的孙进程。
    const child = spawn(binary, [], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        void stopChild(child).finally(() => {
          reject(new InfraError(`parity-router did not become ready\n${stderr}`));
        });
      }
    }, 30_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/PARITY_READY ({.*})/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        try {
          resolvePromise({ child, ready: JSON.parse(match[1]) });
        } catch (error) {
          void stopChild(child).finally(() => reject(error));
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new InfraError(`parity-router exited ${code ?? signal}\n${stderr}`));
      }
    });
  });
}

function stopChild(child, timeoutMs = 5000) {
  return new Promise((resolvePromise) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolvePromise();
    };
    child.once("exit", finish);
    child.once("error", finish);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
      return;
    }
    const termTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        finish();
      }
    }, timeoutMs);
    const killTimer = setTimeout(finish, timeoutMs + 2000);
  });
}

function loadFixture(name) {
  return readFileSync(join(fixturesDir, name), "utf8").trim();
}

function compareApp(name, httpBody, mcpRaw, extra = {}) {
  const issues = [];
  let httpObj;
  let mcpObj;
  try {
    httpObj = wipeVolatile(parseLossless(httpBody));
  } catch (error) {
    issues.push(`http json: ${error.message}`);
  }
  try {
    mcpObj = wipeVolatile(parseLossless(mcpRaw));
  } catch (error) {
    issues.push(`mcp json: ${error.message}`);
  }
  if (httpObj && mcpObj && !deepEqual(httpObj, mcpObj)) {
    issues.push("http/mcp application payload mismatch");
  }
  if (extra.requirePrecision) {
    if (!hasPrecisionToken(httpBody)) issues.push("http lost estimated_cost_micros_usd precision");
    if (!hasPrecisionToken(mcpRaw)) issues.push("mcp lost estimated_cost_micros_usd precision");
  }
  return { ok: issues.length === 0, issues, httpObj, mcpObj };
}

function compareCli(httpBody, cliStdout, extra = {}) {
  const issues = [];
  const trimmed = cliStdout.trim();
  let cliObj;
  let httpObj;
  try {
    cliObj = wipeVolatile(parseLossless(trimmed));
  } catch (error) {
    issues.push(`cli stdout is not application JSON: ${error.message}`);
    return { ok: false, issues };
  }
  try {
    httpObj = wipeVolatile(parseLossless(httpBody));
  } catch (error) {
    issues.push(`http json: ${error.message}`);
    return { ok: false, issues };
  }
  if (!deepEqual(cliObj, httpObj)) issues.push("cli/http application payload mismatch");
  if (extra.requirePrecision && !hasPrecisionToken(trimmed)) {
    issues.push("cli lost estimated_cost_micros_usd precision");
  }
  return { ok: issues.length === 0, issues };
}

async function resetDispatch(dispatchURL) {
  await httpCall(dispatchURL, { method: "POST" });
}

async function readDispatch(dispatchURL) {
  const res = await httpCall(dispatchURL);
  return JSON.parse(res.body);
}

function dispatchMatches(snapshot, want) {
  return (snapshot.quotes || []).length === want.quotes && (snapshot.executes || []).length === want.executes;
}

function dispatchSummary(snapshot, want) {
  return `dispatch quotes=${(snapshot.quotes || []).length} executes=${(snapshot.executes || []).length} want ${want.quotes}/${want.executes}`;
}

async function main() {
  const cliPath = resolveCli(args.cli);
  log(`CLI=${cliPath}`);
  log(`Router pin=${pin}`);
  let work;
  let overlay;
  const report = {
    kind: "Mock E2E",
    pin,
    cli: cliPath,
    cases: [],
    http_mcp: "pending",
    cli_parity: "pending",
  };
  try {
    const prepared = prepareRouterTree();
    work = prepared.work;
    const isolation = prepareIsolation(work);
    overlay = await startOverlay(prepared.binary);
    const { base_url: baseURL, dispatch_url: dispatchURL } = overlay.ready;
    log(`Router overlay ${baseURL}`);
    assertConfigIsolated(isolation, baseURL);
    const health = await httpCall(`${baseURL}/healthz`);
    const ready = await httpCall(`${baseURL}/readyz`);
    if (health.status !== 200 || ready.status !== 200) {
      failInfra(`router probes health=${health.status} ready=${ready.status}`);
    }

    const searchBody = loadFixture("search.json");
    const schemaBody = loadFixture("schema.json");
    const quoteBody = loadFixture("quote-mixed.json");
    const useBody = loadFixture("use-ok.json");

    const cases = [
      {
        id: "search_anonymous",
        httpPath: "/v1/tool-router/aisa-search-tool",
        mcpName: "AISA_SEARCH_TOOL",
        body: searchBody,
        auth: "",
        cli: ["search", "--input", searchBody, "--json"],
        wantHttpStatus: 200,
        wantDispatch: { quotes: 0, executes: 0 },
      },
      {
        id: "schema_partial",
        httpPath: "/v1/tool-router/aisa-batch-get-schema",
        mcpName: "AISA_BATCH_GET_SCHEMA",
        body: schemaBody,
        auth: "",
        cli: ["schema", "--input", schemaBody, "--json"],
        wantHttpStatus: 200,
        wantDispatch: { quotes: 0, executes: 0 },
        check: (httpObj) => {
          if (httpObj.total_count !== 2 || httpObj.success_count !== 1 || httpObj.error_count !== 1) {
            return "schema counts are not partial success";
          }
          return null;
        },
      },
      {
        id: "quote_auth_required",
        httpPath: "/v1/tool-router/aisa-batch-quote",
        mcpName: "AISA_BATCH_QUOTE",
        body: quoteBody,
        auth: "",
        cli: ["quote", "-f", join(fixturesDir, "quote-mixed.json"), "--json"],
        wantHttpStatus: 401,
        wantDispatch: { quotes: 0, executes: 0 },
      },
      {
        id: "quote_partial_precision",
        httpPath: "/v1/tool-router/aisa-batch-quote",
        mcpName: "AISA_BATCH_QUOTE",
        body: quoteBody,
        auth: "caller-key",
        requestId: "req_parity_quote",
        cli: ["quote", "-f", join(fixturesDir, "quote-mixed.json"), "--json"],
        wantHttpStatus: 200,
        requirePrecision: true,
        wantDispatch: { quotes: 3, executes: 0 },
        check: (httpObj) => {
          if (httpObj.total_count !== 3 || httpObj.success_count !== 2 || httpObj.error_count !== 1) {
            return "quote mixed counts unexpected";
          }
          const ids = (httpObj.results || []).map((item) => item.call_id);
          if (JSON.stringify(ids) !== JSON.stringify(["facts", "submit", "fail"])) {
            return "quote result order changed";
          }
          return null;
        },
      },
      {
        id: "quote_stdin",
        httpPath: "/v1/tool-router/aisa-batch-quote",
        mcpName: "AISA_BATCH_QUOTE",
        body: quoteBody,
        auth: "caller-key",
        requestId: "req_parity_quote_stdin",
        cli: ["quote", "-f", "-", "--json"],
        stdin: `${quoteBody}\n`,
        wantHttpStatus: 200,
        requirePrecision: true,
        wantDispatch: { quotes: 3, executes: 0 },
      },
      {
        id: "call_auth_required",
        httpPath: "/v1/tool-router/aisa-batch-use",
        mcpName: "AISA_BATCH_USE",
        body: useBody,
        auth: "",
        cli: ["call", "-f", join(fixturesDir, "use-ok.json"), "--json"],
        wantHttpStatus: 401,
        wantDispatch: { quotes: 0, executes: 0 },
      },
      {
        id: "call_success",
        httpPath: "/v1/tool-router/aisa-batch-use",
        mcpName: "AISA_BATCH_USE",
        body: useBody,
        auth: "caller-key",
        requestId: "req_parity_use",
        cli: ["call", "-f", join(fixturesDir, "use-ok.json"), "--json"],
        wantHttpStatus: 200,
        wantDispatch: { quotes: 0, executes: 1 },
      },
    ];

    let httpMcpFailed = 0;
    let cliFailed = 0;

    for (const testCase of cases) {
      await resetDispatch(dispatchURL);
      const httpRes = await routerHTTP(baseURL, testCase.httpPath, {
        auth: testCase.auth,
        body: testCase.body,
        requestId: testCase.requestId,
      });
      const httpDispatch = await readDispatch(dispatchURL);
      await resetDispatch(dispatchURL);
      const mcpRes = await mcpCall(baseURL, testCase.mcpName, JSON.parse(testCase.body), {
        auth: testCase.auth,
        requestId: testCase.requestId,
      });
      const mcpDispatch = await readDispatch(dispatchURL);
      const pair = compareApp(testCase.id, httpRes.body, mcpRes.raw, {
        requirePrecision: testCase.requirePrecision,
      });
      const httpOk = httpRes.status === testCase.wantHttpStatus;
      const httpDispatchOk = dispatchMatches(httpDispatch, testCase.wantDispatch);
      const mcpDispatchOk = dispatchMatches(mcpDispatch, testCase.wantDispatch);
      let checkIssue = null;
      if (pair.httpObj && testCase.check) checkIssue = testCase.check(pair.httpObj);
      const routerOk =
        httpOk && httpDispatchOk && mcpDispatchOk && pair.ok && !checkIssue && !mcpRes.rpcError;
      if (!routerOk) httpMcpFailed++;

      await resetDispatch(dispatchURL);
      const cliRes = cliCommand(cliPath, testCase.cli, {
        isolation,
        baseURL,
        apiKey: testCase.auth || undefined,
        stdin: testCase.stdin,
      });
      const cliKind = classifyCli(cliRes);
      let cliCompare = { ok: false, issues: [cliKind] };
      if (cliKind === "ran") {
        cliCompare = compareCli(httpRes.body, cliRes.stdout, {
          requirePrecision: testCase.requirePrecision,
        });
        const cliDispatch = await readDispatch(dispatchURL);
        if (!dispatchMatches(cliDispatch, testCase.wantDispatch)) {
          cliCompare.ok = false;
          cliCompare.issues.push(`cli ${dispatchSummary(cliDispatch, testCase.wantDispatch)}`);
        }
        if (testCase.wantHttpStatus >= 400 && cliRes.status === 0) {
          cliCompare.ok = false;
          cliCompare.issues.push("cli exited 0 on error case");
        }
      }
      if (!cliCompare.ok) cliFailed++;

      const row = {
        id: testCase.id,
        http_status: httpRes.status,
        mcp_status: mcpRes.status,
        router_http_mcp: routerOk ? "GREEN" : "RED",
        router_issues: [
          ...(httpOk ? [] : [`http status ${httpRes.status} want ${testCase.wantHttpStatus}`]),
          ...(httpDispatchOk
            ? []
            : [`http ${dispatchSummary(httpDispatch, testCase.wantDispatch)}`]),
          ...(mcpDispatchOk
            ? []
            : [`mcp ${dispatchSummary(mcpDispatch, testCase.wantDispatch)}`]),
          ...pair.issues,
          ...(checkIssue ? [checkIssue] : []),
          ...(mcpRes.rpcError ? [`mcp rpc ${JSON.stringify(mcpRes.rpcError)}`] : []),
        ],
        cli: cliKind === "ran" && cliCompare.ok ? "GREEN" : "RED",
        cli_kind: cliKind,
        cli_exit: cliRes.status,
        cli_issues: cliCompare.issues,
        cli_stderr: (cliRes.stderr || "").trim().split("\n").slice(0, 3).join(" | "),
      };
      report.cases.push(row);
      log(
        `${row.id}: router=${row.router_http_mcp} cli=${row.cli} (${row.cli_kind} exit=${row.cli_exit})`
      );
      if (row.router_issues.length) log(`  router: ${row.router_issues.join("; ")}`);
      if (row.cli_issues.length) log(`  cli: ${row.cli_issues.join("; ")}`);
    }

    report.http_mcp = httpMcpFailed === 0 ? "GREEN" : "RED";
    report.cli_parity = cliFailed === 0 ? "GREEN" : "RED";
    report.router_env_aliases = ["AISA_ROUTER_URL", "AISA_ROUTER_BASE_URL"];
    report.expected_baseline =
      "CLI RED if schema/quote/call or Router-backed search --json are absent; HTTP/MCP must be GREEN";
    console.log(JSON.stringify(report, null, 2));
    if (httpMcpFailed) {
      process.exitCode = 2;
      return;
    }
    if (cliFailed) {
      process.exitCode = 1;
    }
  } finally {
    await stopChild(overlay?.child);
    if (work) rmSync(work, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof InfraError) {
    console.error(`INFRA: ${error.message}`);
    process.exitCode = 2;
  } else {
    console.error(`INFRA: ${error.stack || String(error)}`);
    process.exitCode = 2;
  }
}
