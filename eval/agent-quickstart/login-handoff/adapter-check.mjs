import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const [out, piBin] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(out, "manifest.json")));
const cases = JSON.parse(readFileSync(join(here, "cases.json")));
assert.deepEqual(cases.map(x => x.id), ["link-now", "done-not-code", "no-pty", "expired", "return-code"]);
const bundle = join(out, "adapter.cjs");
buildSync({ entryPoints: [join(here, "extension.ts")], outfile: bundle, bundle: true, platform: "node", format: "cjs",
  alias: { "@sinclair/typebox": createRequire(piBin).resolve("typebox") } });
const extension = createRequire(import.meta.url)(bundle).default;
const checks = [];
for (const arm of ["full", "ablated"]) {
  const folder = join(out, "adapter-" + arm);
  mkdirSync(folder);
  const path = join(folder, "state.json");
  const ledger = join(folder, "tools.jsonl");
  let state = { arm, cli: manifest.install_meta[arm].cli, expected_help_hash: manifest.help_sha256[arm],
    guide: join(out, "guide.md"), skill: join(out, "skill.md"), home: folder, ledger,
    spec: cases[4], live_session: cases[4].live_session, authenticated: false };
  const save = () => writeFileSync(path, JSON.stringify(state));
  save();
  process.env.AISA_HANDOFF_STATE = path;
  const tools = new Map();
  extension({ registerTool: tool => tools.set(tool.name, tool) });
  const call = (name, args = {}) => tools.get(name).execute("check", args);
  await call("read_skill");
  await call("aisa_cli", { args: ["login", "--help"] });
  const events = JSON.parse("[" + readFileSync(ledger, "utf8").trim().split("\n").join(",") + "]");
  assert.equal(events[0].tool, "read_skill");
  assert.equal(events[1].real_help, true);
  assert.equal(events[1].sha256, state.expected_help_hash);
  await call("aisa_cli", { args: ["--version"] });
  const versionEvent = JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").at(-1));
  assert.equal(versionEvent.real_cli_info, true);
  assert.equal(versionEvent.real_help, false);
  await call("aisa_cli", { args: ["balance"] }); // A legitimate unsuccessful auth check.
  assert.equal(JSON.parse(readFileSync(path)).authenticated, false);
  for (const input of [{ session_id: "dead-session", text: cases[4].expected_input },
    { session_id: state.live_session, text: "stale-code" }]) {
    await call("terminal_input", input);
    assert.equal(JSON.parse(readFileSync(path)).authenticated, false);
  }
  const valid = { session_id: state.live_session, text: cases[4].expected_input };
  await call("terminal_input", valid);
  assert.equal(JSON.parse(readFileSync(path)).authenticated, true);
  await call("terminal_input", valid); // Rejected duplicate.
  await call("aisa_cli", { args: ["balance"] });
  const rows = readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.filter(x => x.tool === "terminal_input" && x.allowed).length, 1);
  assert.equal(rows.filter(x => x.tool === "terminal_input" && !x.allowed).length, 3);
  assert.equal(rows.at(-1).authenticated, true);
  state = { ...state, spec: cases[2], live_session: null, authenticated: false }; save();
  await call("aisa_cli", { args: ["login", "--no-browser"] });
  assert.equal(JSON.parse(readFileSync(path)).live_session, null);
  for (const args of [["login"], ["login", "--no-browser"]]) {
    state = { ...state, spec: cases[3], live_session: null }; save();
    await call("aisa_cli", { args });
    assert.equal(JSON.parse(readFileSync(path)).live_session, "login-fixture-new-42");
  }
  checks.push({ arm, actual_help: true, wrong_stale_duplicate_refused: true, one_write_then_balance: true,
    no_tty_refused: true, automatic_and_explicit_headless_supported: true });
}
writeFileSync(join(out, "adapter-check.json"), JSON.stringify(checks, null, 2) + "\n");
console.log("PASS: registered adapter, real help and synthetic refusal/relay guards; no model/OAuth");
