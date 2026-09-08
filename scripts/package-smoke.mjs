#!/usr/bin/env node
// Isolated npm-package smoke: pack the real tarball, install it into a
// throwaway prefix, and probe the installed bin. No publish, tag, or global
// install. Does not copy tests/e2e — parent reuses that harness on install_bin.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const FAKE_KEY = "local-smoke-key";
const MISSING_KEY = /No API key found[\s\S]*aisa login --key[\s\S]*AISA_API_KEY/;
const BIG = "9007199254740993";

const SEARCH_REQ = '{"query":"company facts","limit":3}';
const SCHEMA_REQ = '{"tools":["getFacts","missing"]}';
const BATCH_REQ =
  '{"calls":[{"call_id":"c1","tool":"getFacts","arguments":{"ticker":"NVDA"}}]}';

const SEARCH_RES =
  '{"search_id":"smoke-search","tools":[{"tool":"getFacts","summary":"ok","has_full_schema":true}],"next_steps_guidance":[]}';
const SCHEMA_RES =
  '{"total_count":2,"success_count":1,"error_count":1,"tools":{"getFacts":{"successful":true},"missing":{"successful":false,"error":{"code":"not_found","message":"gone"}}},"next_steps_guidance":[]}';
const QUOTE_RES = `{"batch_id":"smoke-quote","total_count":1,"success_count":1,"error_count":0,"results":[{"call_id":"c1","tool":"getFacts","successful":true,"request_id":"r1","data":{"object":"cost_estimate","estimate_kind":"estimate","estimated_cost_micros_usd":${BIG},"may_exceed_estimate":true}}],"next_steps_guidance":[]}`;
const CALL_RES =
  '{"batch_id":"smoke-call","total_count":1,"success_count":1,"error_count":0,"results":[{"call_id":"c1","tool":"getFacts","successful":true,"request_id":"r2","customer_cost_micros_usd":1}],"next_steps_guidance":[]}';

const PATHS = {
  search: "/v1/tool-router/aisa-search-tool",
  schema: "/v1/tool-router/aisa-batch-get-schema",
  quote: "/v1/tool-router/aisa-batch-quote",
  call: "/v1/tool-router/aisa-batch-use",
};

class InfraError extends Error {
  constructor(message) {
    super(message);
    this.name = "InfraError";
  }
}

function parseArgs(argv) {
  const out = { tarball: "", keepOutput: false, output: "", liveDiscovery: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tarball") out.tarball = argv[++i] || "";
    else if (arg === "--keep-output") out.keepOutput = true;
    else if (arg === "--output") out.output = argv[++i] || "";
    else if (arg === "--live-discovery") out.liveDiscovery = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new InfraError(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/package-smoke.mjs [--tarball FILE] [--output DIR] [--keep-output] [--live-discovery]

Build (unless --tarball), npm pack, install into an isolated prefix, and probe
the installed aisa bin. Prints a JSON report. Does not publish, tag, or install globally.

  --tarball FILE     Skip build/pack; inspect and install this archive
  --output DIR       Write tarball, prefix, report.json here (kept)
  --keep-output      Keep the temp artifact directory
  --live-discovery   Default-off Real API E2E: anonymous search then schema at the
                     installed default origin. Never quote or call.
`);
}

function log(message) {
  console.error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function npmEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AISA_")) delete env[key];
  }
  return env;
}

function runNpm(args, cwd) {
  const result = spawnSync("npm", args, {
    cwd,
    encoding: "utf8",
    env: npmEnv(),
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error || "").trim();
    throw new InfraError(
      `npm ${args.join(" ")} failed (exit ${result.status ?? "spawn"}) in ${cwd}\n${detail}`
    );
  }
  return result;
}

function gitHead() {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function isolateTree(root) {
  const home = join(root, "home");
  const xdg = {
    config: join(root, "xdg-config"),
    data: join(root, "xdg-data"),
    state: join(root, "xdg-state"),
    cache: join(root, "xdg-cache"),
  };
  const tmp = join(root, "tmp");
  const cwd = join(root, "cwd");
  for (const dir of [
    home,
    xdg.config,
    xdg.data,
    xdg.state,
    xdg.cache,
    tmp,
    cwd,
    join(home, ".aisa"),
    join(home, "Library", "Preferences"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  return { home, xdg, tmp, cwd };
}

function cliEnv(isolation, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: isolation.home,
    USERPROFILE: isolation.home,
    XDG_CONFIG_HOME: isolation.xdg.config,
    XDG_DATA_HOME: isolation.xdg.data,
    XDG_STATE_HOME: isolation.xdg.state,
    XDG_CACHE_HOME: isolation.xdg.cache,
    TMPDIR: isolation.tmp,
    ...extra,
  };
}

function runInstalled(bin, args, isolation, extraEnv = {}, stdin, timeoutMs = 20_000) {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd: isolation.cwd,
      env: cliEnv(isolation, extraEnv),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ status: 1, stdout, stderr, error: "timeout" });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.end(stdin === undefined ? "" : stdin);
    child.on("error", (error) => {
      finish({ status: 1, stdout, stderr, error: String(error) });
    });
    child.on("close", (status) => {
      finish({ status: status ?? 1, stdout, stderr, error: "" });
    });
  });
}

function expectRawJson(stdout, raw) {
  const want = raw.endsWith("\n") ? raw : `${raw}\n`;
  return stdout === want;
}

function probeDetail(ran, stub) {
  return `exit ${ran.status} stdout=${JSON.stringify((ran.stdout || "").slice(0, 120))} hits=${JSON.stringify(stub.hits)}`;
}

function firstSearchTool(stdout) {
  try {
    const tools = JSON.parse(String(stdout).trim()).tools;
    const first = Array.isArray(tools)
      ? tools.find((item) => item && typeof item.tool === "string" && item.tool.trim())
      : undefined;
    return first ? first.tool.trim() : "";
  } catch {
    return "";
  }
}

function schemaItem(stdout, tool) {
  try {
    const tools = JSON.parse(String(stdout).trim()).tools;
    return tools && typeof tools === "object" ? tools[tool] : undefined;
  } catch {
    return undefined;
  }
}

function findManifest(node, path) {
  if (!node) return undefined;
  if (node.path === path) return node;
  for (const child of node.subcommands || []) {
    const hit = findManifest(child, path);
    if (hit) return hit;
  }
  return undefined;
}

function listTarball(tarball) {
  const result = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new InfraError(`tar -tzf failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPackedFile(tarball, name) {
  const result = spawnSync("tar", ["-xOf", tarball, name], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout;
}

function readPackedPackageJson(tarball) {
  const text = readPackedFile(tarball, "package/package.json");
  if (!text) throw new InfraError("tar -xOf package/package.json failed");
  return JSON.parse(text);
}

function readSourceVersion(root) {
  const path = join(root, "src/constants.ts");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").match(/export const VERSION = "([^"]+)"/)?.[1] ?? null;
}

function isMitText(text) {
  return /MIT License/i.test(text) && /Permission is hereby granted/i.test(text);
}

function startStub() {
  const hits = [];
  let redirectQuote = false;
  const bodies = {
    [PATHS.search]: SEARCH_RES,
    [PATHS.schema]: SCHEMA_RES,
    [PATHS.quote]: QUOTE_RES,
    [PATHS.call]: CALL_RES,
  };

  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url || "/";
      hits.push({
        method: req.method,
        path,
        authorization: String(req.headers.authorization || ""),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      if (redirectQuote && path === PATHS.quote) {
        res.writeHead(307, { location: "/trap" });
        res.end("redirected");
        return;
      }
      if (path === "/trap") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"executed":true}');
        return;
      }
      const body = bodies[path];
      if (!body) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"error":"unknown_path"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
  });

  return new Promise((resolvePromise, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new InfraError("stub Router did not bind a TCP port"));
        return;
      }
      resolvePromise({
        hits,
        setRedirectQuote(value) {
          redirectQuote = value;
        },
        resetHits() {
          hits.length = 0;
        },
        baseURL: `http://127.0.0.1:${addr.port}`,
        close() {
          return new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          });
        },
      });
    });
    server.on("error", reject);
  });
}

function parseNpmPack(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new InfraError(`npm pack --json produced no array:\n${stdout}`);
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    throw new InfraError(`npm pack --json parse failed: ${error.message}\n${stdout}`);
  }
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 18) {
    throw new InfraError(`Node >= 18 required; running ${process.version}`);
  }

  const args = parseArgs(process.argv.slice(2));
  const keep = Boolean(args.output) || args.keepOutput;
  const work = args.output
    ? resolve(args.output)
    : mkdtempSync(join(tmpdir(), "aisa-cli-package-smoke-"));
  mkdirSync(work, { recursive: true });

  const checks = [];
  const check = (id, ok, detail = "", expectedLimitation = "", loop = "") => {
    checks.push({
      id,
      ok: Boolean(ok),
      detail,
      ...(expectedLimitation ? { expected_limitation: expectedLimitation } : {}),
      ...(loop ? { loop } : {}),
    });
    const mark = ok ? "PASS" : expectedLimitation ? "LIMIT" : "FAIL";
    log(`${mark} ${id}${detail ? ` — ${detail}` : ""}`);
  };

  const sourcePkg = existsSync(join(repoRoot, "package.json"))
    ? readJson(join(repoRoot, "package.json"))
    : null;
  let stub;
  let installBin = "";
  let tarballPath = "";
  let tarballSha = "";
  let packedPkg = null;
  let candidate = "";
  let liveTool = "";

  const report = () => ({
    kind: "package-smoke",
    candidate_version: candidate,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    git_head: gitHead(),
    source_package_version: sourcePkg?.version ?? null,
    packed_package_version: packedPkg?.version ?? null,
    tarball: tarballPath,
    tarball_sha256: tarballSha,
    install_prefix: join(work, "prefix"),
    install_bin: installBin,
    keep_output: keep,
    output_dir: keep ? work : null,
    tested: { node: process.version, os: process.platform, arch: process.arch },
    parity_reuse: {
      entry: "tests/e2e/run.sh",
      command:
        "AISA_ROUTER_SNAPSHOT=<router-checkout> tests/e2e/run.sh --cli <install_bin> --skip-build",
      note: "This smoke does not copy or run the Mock E2E harness. Parent should pass install_bin.",
    },
    canonical_router_env: "AISA_ROUTER_BASE_URL",
    live_discovery: args.liveDiscovery,
    live_tool: liveTool || null,
    checks,
    ok: checks.every((item) => item.ok || item.expected_limitation),
  });

  try {
    const isolation = isolateTree(join(work, "iso"));
    const prefix = join(work, "prefix");
    mkdirSync(prefix, { recursive: true });
    mkdirSync(join(work, "artifacts"), { recursive: true });

    if (args.tarball) {
      const given = isAbsolute(args.tarball) ? args.tarball : resolve(process.cwd(), args.tarball);
      if (!existsSync(given)) throw new InfraError(`--tarball not found: ${given}`);
      packedPkg = readPackedPackageJson(given);
      candidate = packedPkg.version;
      tarballPath = join(work, "artifacts", `aisa-one-cli-${candidate}.tgz`);
      copyFileSync(given, tarballPath);
    } else {
      if (!sourcePkg) throw new InfraError(`package.json missing at ${repoRoot}`);
      candidate = sourcePkg.version;
      if (!existsSync(join(repoRoot, "node_modules"))) {
        log("node_modules missing; running npm ci");
        runNpm(["ci"], repoRoot);
      }
      if (sourcePkg.scripts?.prepack) {
        const dist = join(repoRoot, "dist");
        if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
        log("npm pack (prepack builds)");
      } else {
        log("npm run build");
        runNpm(["run", "build"], repoRoot);
      }
      const packDir = join(work, "pack");
      mkdirSync(packDir, { recursive: true });
      log("npm pack");
      const packOut = runNpm(["pack", "--json", `--pack-destination=${packDir}`], repoRoot).stdout;
      let filename = parseNpmPack(packOut)[0]?.filename;
      const tgzFiles = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
      if (!filename && tgzFiles.length === 1) filename = tgzFiles[0];
      if (!filename) {
        throw new InfraError(`npm pack did not produce a tarball in ${packDir}`);
      }
      if (!existsSync(join(packDir, filename))) {
        if (tgzFiles.length !== 1) throw new InfraError(`npm pack missing ${join(packDir, filename)}`);
        filename = tgzFiles[0];
      }
      const packedFile = join(packDir, filename);
      packedPkg = readPackedPackageJson(packedFile);
      tarballPath = join(work, "artifacts", filename);
      copyFileSync(packedFile, tarballPath);
    }

    tarballSha = sha256File(tarballPath);
    const entries = listTarball(tarballPath);
    const has = (suffix) => entries.some((entry) => entry === suffix || entry === `${suffix}/`);
    check("tarball-package-json", has("package/package.json"));
    check("tarball-dist-index", has("package/dist/index.js"));
    check("tarball-readme", has("package/README.md"));
    check(
      "tarball-excludes-source-tests",
      !entries.some((entry) => entry.startsWith("package/src/") || entry.startsWith("package/tests/"))
    );
    check("packed-name", packedPkg.name === "@aisa-one/cli", packedPkg.name);
    check("packed-bin", packedPkg.bin?.aisa === "dist/index.js", String(packedPkg.bin?.aisa || ""));
    check("packed-version", packedPkg.version === candidate, `${packedPkg.version} vs ${candidate}`);
    if (!args.tarball && sourcePkg) {
      check("source-version", sourcePkg.version === candidate, sourcePkg.version);
      if (existsSync(join(repoRoot, "package-lock.json"))) {
        const lock = readJson(join(repoRoot, "package-lock.json"));
        const lockVer = lock.packages?.[""]?.version || lock.version;
        check("lockfile-version", lockVer === candidate, String(lockVer));
      }
      const constVer = readSourceVersion(repoRoot);
      if (constVer !== null) {
        check("source-constants-version", constVer === candidate, String(constVer));
      }
    }
    check("license-declared", packedPkg.license === "MIT", String(packedPkg.license || ""));
    const sourceLicensePath = join(repoRoot, "LICENSE");
    const sourceHasLicense = !args.tarball && existsSync(sourceLicensePath);
    const packedHasLicense = has("package/LICENSE");
    const packedLicense = packedHasLicense ? readPackedFile(tarballPath, "package/LICENSE") : "";
    check("license-text", packedHasLicense && isMitText(packedLicense), packedHasLicense ? "shipped" : "missing");
    if (sourceHasLicense) {
      const sourceLicense = readFileSync(sourceLicensePath, "utf8");
      check("license-source-agreement", isMitText(sourceLicense) && packedHasLicense && sourceLicense === packedLicense);
    }

    log(`npm install --prefix ${prefix}`);
    runNpm(["install", "--omit=dev", "--prefix", prefix, tarballPath], work);
    installBin = join(prefix, "node_modules", ".bin", "aisa");
    check("install-bin", existsSync(installBin), installBin);
    if (!existsSync(installBin)) {
      throw new InfraError(`installed bin missing: ${installBin}`);
    }

    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        "const os=require('os'); const path=require('path'); process.stdout.write(JSON.stringify({home:os.homedir(),xdg:process.env.XDG_CONFIG_HOME||'',darwin:path.join(os.homedir(),'Library','Preferences')}));",
      ],
      { cwd: isolation.cwd, env: cliEnv(isolation), encoding: "utf8" }
    );
    const probeInfo = probe.status === 0 ? JSON.parse(probe.stdout) : {};
    check(
      "isolation-home",
      String(probeInfo.home || "").startsWith(isolation.home),
      String(probeInfo.home || probe.stderr)
    );

    const version = await runInstalled(installBin, ["--version"], isolation);
    check(
      "cli-version",
      version.status === 0 && version.stdout.trim() === candidate,
      `exit ${version.status} stdout=${JSON.stringify(version.stdout.trim())}`
    );

    const help = await runInstalled(installBin, ["--help"], isolation);
    const helpText = `${help.stdout}\n${help.stderr}`;
    check(
      "help-router-commands",
      help.status === 0 &&
        /\bsearch\b/.test(helpText) &&
        /\bschema\b/.test(helpText) &&
        /\bquote\b/.test(helpText) &&
        /\bcall\b/.test(helpText)
    );

    const searchHelp = await runInstalled(installBin, ["search", "--help"], isolation);
    check(
      "help-search-io",
      searchHelp.status === 0 &&
        /--json/.test(searchHelp.stdout) &&
        /--input/.test(searchHelp.stdout) &&
        /-f, --file/.test(searchHelp.stdout)
    );

    const deprecatedHelp = await runInstalled(installBin, ["api", "search", "--help"], isolation);
    check(
      "help-api-search-deprecated",
      deprecatedHelp.status === 0 && /\[deprecated\]/.test(deprecatedHelp.stdout)
    );

    const manifestRoot = await runInstalled(installBin, ["manifest"], isolation);
    let manifest;
    try {
      manifest = JSON.parse(manifestRoot.stdout);
    } catch (error) {
      check("manifest-json", false, error.message);
    }
    if (manifest) {
      check("manifest-json", manifestRoot.status === 0);
      for (const name of ["search", "schema", "quote", "call"]) {
        const node = findManifest(manifest, `aisa ${name}`);
        check(`manifest-${name}`, Boolean(node) && node.deprecated !== true);
      }
      const expected = [
        ["aisa api search", "search"],
        ["aisa api show", "schema"],
        ["aisa run", "call"],
      ];
      for (const [path, replacement] of expected) {
        const node = findManifest(manifest, path);
        check(
          `manifest-deprecation-${path.replace(/\s+/g, "-")}`,
          Boolean(node?.deprecated) &&
            node.replacement === replacement &&
            typeof node.migration === "string" &&
            /separately announced/.test(node.migration) &&
            !/v0\.|2026/.test(node.migration)
        );
      }
      check("manifest-api-list-not-deprecated", findManifest(manifest, "aisa api list")?.deprecated !== true);
    }

    const legacy = await runInstalled(installBin, ["run", "financial", "/health"], isolation);
    check(
      "deprecation-stderr-run",
      legacy.status === 1 &&
        /deprecated: aisa run/.test(legacy.stderr) &&
        MISSING_KEY.test(legacy.stderr) &&
        legacy.stdout.trim() === ""
    );

    stub = await startStub();
    const routerEnv = { AISA_ROUTER_BASE_URL: stub.baseURL };

    stub.resetHits();
    const usage = await runInstalled(installBin, ["quote"], isolation, routerEnv);
    check(
      "quote-usage-exit",
      usage.status === 2 && stub.hits.length === 0,
      `exit ${usage.status} hits=${stub.hits.length}`
    );

    stub.resetHits();
    const conflict = await runInstalled(
      installBin,
      ["search", "--input", SEARCH_REQ, "-f", join(isolation.tmp, "nope.json"), "--json"],
      isolation,
      routerEnv
    );
    check(
      "conflict-input-no-dispatch",
      conflict.status === 2 && stub.hits.length === 0,
      `exit ${conflict.status} hits=${stub.hits.length}`
    );

    stub.resetHits();
    const noKey = await runInstalled(
      installBin,
      ["quote", "--input", BATCH_REQ, "--json"],
      isolation,
      routerEnv
    );
    check(
      "quote-local-missing-key",
      noKey.status === 1 &&
        noKey.stdout.trim() === "" &&
        MISSING_KEY.test(noKey.stderr) &&
        stub.hits.length === 0
    );

    stub.resetHits();
    const search = await runInstalled(
      installBin,
      ["search", "--input", SEARCH_REQ, "--json"],
      isolation,
      routerEnv
    );
    check(
      "search-json",
      search.status === 0 &&
        expectRawJson(search.stdout, SEARCH_RES) &&
        stub.hits.length === 1 &&
        stub.hits[0].path === PATHS.search &&
        stub.hits[0].body === SEARCH_REQ &&
        stub.hits[0].authorization === "",
      probeDetail(search, stub)
    );

    stub.resetHits();
    const schema = await runInstalled(
      installBin,
      ["schema", "--input", SCHEMA_REQ, "--json"],
      isolation,
      routerEnv
    );
    check(
      "schema-partial-exit3",
      schema.status === 3 &&
        expectRawJson(schema.stdout, SCHEMA_RES) &&
        stub.hits.length === 1 &&
        stub.hits[0].path === PATHS.schema,
      probeDetail(schema, stub)
    );

    const requestFile = join(isolation.tmp, "quote.json");
    writeFileSync(requestFile, `${BATCH_REQ}\n`);
    stub.resetHits();
    const quoteFile = await runInstalled(
      installBin,
      ["quote", "-f", requestFile, "--json"],
      isolation,
      { ...routerEnv, AISA_API_KEY: FAKE_KEY }
    );
    check(
      "quote-file-json",
      quoteFile.status === 0 &&
        expectRawJson(quoteFile.stdout, QUOTE_RES) &&
        quoteFile.stdout.includes(BIG) &&
        stub.hits.length === 1 &&
        stub.hits[0].path === PATHS.quote &&
        stub.hits[0].body.trim() === BATCH_REQ &&
        stub.hits[0].authorization === `Bearer ${FAKE_KEY}`,
      probeDetail(quoteFile, stub)
    );

    stub.resetHits();
    const quoteStdin = await runInstalled(
      installBin,
      ["quote", "-f", "-", "--json"],
      isolation,
      { ...routerEnv, AISA_API_KEY: FAKE_KEY },
      `${BATCH_REQ}\n`
    );
    check(
      "quote-stdin-json",
      quoteStdin.status === 0 &&
        expectRawJson(quoteStdin.stdout, QUOTE_RES) &&
        stub.hits.length === 1 &&
        stub.hits[0].path === PATHS.quote,
      probeDetail(quoteStdin, stub)
    );

    stub.resetHits();
    const call = await runInstalled(
      installBin,
      ["call", "--input", BATCH_REQ, "--json"],
      isolation,
      { ...routerEnv, AISA_API_KEY: FAKE_KEY }
    );
    check(
      "call-json",
      call.status === 0 &&
        expectRawJson(call.stdout, CALL_RES) &&
        stub.hits.length === 1 &&
        stub.hits[0].path === PATHS.call &&
        stub.hits[0].authorization === `Bearer ${FAKE_KEY}`,
      probeDetail(call, stub)
    );

    stub.setRedirectQuote(true);
    stub.resetHits();
    const redirected = await runInstalled(
      installBin,
      ["quote", "--input", BATCH_REQ, "--json"],
      isolation,
      { ...routerEnv, AISA_API_KEY: FAKE_KEY }
    );
    check(
      "quote-no-redirect",
      redirected.status === 1 &&
        redirected.stdout.includes("redirected") &&
        !redirected.stdout.includes("executed") &&
        stub.hits.map((hit) => `${hit.method} ${hit.path}`).join(",") === `POST ${PATHS.quote}`,
      probeDetail(redirected, stub)
    );
    stub.setRedirectQuote(false);
    await stub.close();
    stub = undefined;

    if (args.liveDiscovery) {
      // Default origin only: no AISA_ROUTER_* override, no key, no inherited AISA_*.
      const liveSearch = await runInstalled(
        installBin,
        ["search", "company profile", "--limit", "1", "--json"],
        isolation,
        {},
        undefined,
        45_000
      );
      liveTool = firstSearchTool(liveSearch.stdout);
      check(
        "live-discovery-search",
        liveSearch.status === 0 && Boolean(liveTool),
        liveTool || `exit ${liveSearch.status} ${liveSearch.stdout.slice(0, 160) || liveSearch.stderr.slice(0, 160)}`,
        "",
        "Real API E2E"
      );
      if (liveTool) {
        const liveSchema = await runInstalled(
          installBin,
          ["schema", liveTool, "--json"],
          isolation,
          {},
          undefined,
          45_000
        );
        const item = schemaItem(liveSchema.stdout, liveTool);
        check(
          "live-discovery-schema",
          liveSchema.status === 0 && item?.successful === true && item.arguments_schema !== undefined,
          `${liveTool} exit ${liveSchema.status} successful=${item?.successful} schema=${item?.arguments_schema !== undefined}`,
          "",
          "Real API E2E"
        );
      } else {
        check("live-discovery-schema", false, "skipped: no tool from search", "", "Real API E2E");
      }
    }

    const final = report();
    writeFileSync(join(work, "report.json"), `${JSON.stringify(final, null, 2)}\n`);
    console.log(JSON.stringify(final, null, 2));
    if (!final.ok) process.exitCode = 1;
  } finally {
    if (stub) await stub.close();
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof InfraError) {
    console.error(`INFRA: ${error.message}`);
  } else {
    console.error(`INFRA: ${error.stack || String(error)}`);
  }
  process.exitCode = 2;
}
