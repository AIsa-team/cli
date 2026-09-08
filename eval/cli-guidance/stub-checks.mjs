/**
 * Offline stub / harness fidelity checks. Standalone node:test (not *.test.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  NOTE,
  NOTE_SCHEMA,
  PROFILE,
  PROFILE_SCHEMA,
  preflightBatch,
  startStub,
} from "./stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function nvda(call_id = "c1") {
  return { call_id, tool: PROFILE, arguments: { ticker: "NVDA" } };
}

async function post(url, path, body, headers = {}) {
  const res = await fetch(new URL(path, url), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("search publishes the declared NOTE schema", () => {
  it("includes arguments_schema when has_full_schema is true", async () => {
    const stub = await startStub({ caseId: "stub-checks" });
    try {
      const res = await post(stub.url, "/v1/tool-router/aisa-search-tool", { query: "note" });
      assert.equal(res.status, 200);
      const note = res.body.tools.find((t) => t.tool === NOTE);
      const profile = res.body.tools.find((t) => t.tool === PROFILE);
      assert.equal(note.has_full_schema, true);
      assert.deepEqual(note.arguments_schema, NOTE_SCHEMA);
      assert.equal(typeof note.description, "string");
      assert.deepEqual(note.price, {});
      assert.equal(profile.has_full_schema, false);
      assert.equal(profile.arguments_schema, undefined);
      assert.equal(typeof profile.description, "string");
      assert.deepEqual(profile.price, {});
      assert.deepEqual(res.body.plan.primary_tools, [PROFILE, NOTE]);
      assert.deepEqual(res.body.plan.related_tools, []);
    } finally {
      await stub.close();
    }
  });
});

describe("batch preflight is whole-batch 400", () => {
  it("accepts declared PROFILE and NOTE arguments", () => {
    assert.equal(preflightBatch([nvda()]).ok, true);
    assert.equal(
      preflightBatch([{ call_id: "n1", tool: NOTE, arguments: { text: "He said \"你好—O'Reilly\"" } }]).ok,
      true
    );
  });

  it("rejects unknown tools, extra keys, missing keys, and wrong types", () => {
    assert.equal(preflightBatch([nvda(), { call_id: "x", tool: "get_financial_company_facts", arguments: { ticker: "NVDA" } }]).ok, false);
    assert.equal(preflightBatch([{ call_id: "x", tool: PROFILE, arguments: { ticker: "NVDA", extra: 1 } }]).ok, false);
    assert.equal(preflightBatch([{ call_id: "x", tool: PROFILE, arguments: {} }]).ok, false);
    assert.equal(preflightBatch([{ call_id: "x", tool: PROFILE, arguments: { ticker: 1 } }]).ok, false);
    assert.equal(preflightBatch([{ call_id: "x", tool: NOTE, arguments: { text: 1 } }]).ok, false);
  });

  it("returns HTTP 400 for quote/use and does not invent per-item success", async () => {
    const stub = await startStub({ caseId: "stub-checks" });
    try {
      const auth = { authorization: "Bearer aisa_eval_synthetic_key_not_real" };
      const bad = {
        calls: [nvda("ok"), { call_id: "bad", tool: "guessed_tool", arguments: { ticker: "NVDA" } }],
      };
      const quote = await post(stub.url, "/v1/tool-router/aisa-batch-quote", bad, auth);
      const use = await post(stub.url, "/v1/tool-router/aisa-batch-use", bad, auth);
      assert.equal(quote.status, 400);
      assert.equal(use.status, 400);
      assert.equal(quote.body.error.code, "invalid_arguments");
      assert.equal(typeof quote.body.request_id, "string");
      assert.equal(typeof quote.body.error.message, "string");
      assert.equal(typeof quote.body.error.details, "object");
      assert.equal(quote.body.error.retryable, false);
      assert.equal(quote.body.code, undefined);
      assert.equal(quote.body.results, undefined);
      assert.equal(use.body.results, undefined);
      const extra = await post(
        stub.url,
        "/v1/tool-router/aisa-batch-quote",
        { calls: [{ call_id: "e", tool: PROFILE, arguments: { ticker: "NVDA", limit: 1 } }] },
        auth
      );
      assert.equal(extra.status, 400);

      const good = await post(stub.url, "/v1/tool-router/aisa-batch-quote", { calls: [nvda()] }, auth);
      assert.equal(good.status, 200);
      assert.equal(good.body.results[0].successful, true);
      assert.equal(good.body.results[0].tool, PROFILE);

      const fail = await post(
        stub.url,
        "/v1/tool-router/aisa-batch-quote",
        { calls: [{ call_id: "f", tool: PROFILE, arguments: { ticker: "FAIL" } }] },
        auth
      );
      assert.equal(fail.status, 200);
      assert.equal(fail.body.results[0].successful, false);
      assert.equal(typeof fail.body.results[0].request_id, "string");
      assert.equal(fail.body.results[0].error.type, "upstream");
      assert.equal(typeof fail.body.results[0].error.status, "number");
      assert.equal(typeof fail.body.results[0].error.retryable, "boolean");

      const unauth = await post(stub.url, "/v1/tool-router/aisa-batch-quote", { calls: [nvda()] });
      assert.equal(unauth.status, 401);
      assert.equal(unauth.body.error.code, "authentication_required");
      assert.equal(typeof unauth.body.request_id, "string");
      assert.equal(typeof unauth.body.error.details, "object");
      assert.equal(unauth.body.error.retryable, false);
    } finally {
      await stub.close();
    }
  });
});

describe("extension charges denied invocations", () => {
  it("increments and ledgers before blocked returns", () => {
    const src = readFileSync(join(HERE, "extension.ts"), "utf8");
    const execute = src.indexOf("async execute");
    const body = src.slice(execute);
    const charge = body.indexOf("calls += 1");
    const ledger = body.indexOf("appendFileSync");
    const blockedReturn = body.indexOf("blocked: ${blocked}");
    assert.ok(execute >= 0 && charge >= 0);
    assert.ok(charge < ledger);
    assert.ok(ledger < blockedReturn);
    assert.match(body, /invocation: calls/);
    assert.doesNotMatch(body, /if \(denied\) \{\s*return/);
  });
});
