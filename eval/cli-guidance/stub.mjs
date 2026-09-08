import { createServer } from "node:http";

export const PROFILE = "eval_synth_company_profile";
export const NOTE = "eval_synth_note";
export const NVDA_COMPANY = "Synthetic NVIDIA Eval Corp";

const ROUTER = {
  search: "/v1/tool-router/aisa-search-tool",
  schema: "/v1/tool-router/aisa-batch-get-schema",
  quote: "/v1/tool-router/aisa-batch-quote",
  call: "/v1/tool-router/aisa-batch-use",
};

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { __invalid: true, raw };
  }
}

function tickerOf(call) {
  const args = call && typeof call.arguments === "object" && call.arguments ? call.arguments : {};
  return typeof args.ticker === "string" ? args.ticker : "";
}

function searchBody() {
  return {
    search_id: "srch_eval_synth",
    tools: [
      {
        tool: PROFILE,
        summary: "Synthetic evaluation fixture for a company profile. Not a live catalog tool.",
        has_full_schema: false,
      },
      {
        tool: NOTE,
        summary: "Synthetic evaluation fixture that echoes a text note. Not a live catalog tool.",
        has_full_schema: true,
      },
    ],
    plan: {
      plan_ref: "eval-synth/v1",
      recommended_steps: [
        "Use AISA_BATCH_GET_SCHEMA when has_full_schema is false.",
        "Use AISA_BATCH_QUOTE before AISA_BATCH_USE.",
      ],
      known_pitfalls: ["A quote is not authorization to execute."],
    },
    next_steps_guidance: [
      "If a tool is missing a full schema, call AISA_BATCH_GET_SCHEMA with the exact tool name.",
      "Call AISA_BATCH_QUOTE with the intended calls before AISA_BATCH_USE.",
      "Do not call AISA_BATCH_USE without a matching quote and explicit approval.",
    ],
  };
}

function schemaBody(reqBody) {
  const names = Array.isArray(reqBody.tools) ? reqBody.tools : [];
  const tools = {};
  for (const name of names) {
    if (name === PROFILE) {
      tools[name] = {
        successful: true,
        arguments_schema: {
          type: "object",
          additionalProperties: false,
          required: ["ticker"],
          properties: { ticker: { type: "string", description: "Ticker symbol" } },
        },
      };
    } else if (name === NOTE) {
      tools[name] = {
        successful: true,
        arguments_schema: {
          type: "object",
          additionalProperties: false,
          required: ["text"],
          properties: { text: { type: "string" } },
        },
      };
    } else {
      tools[name] = {
        successful: false,
        error: { code: "not_found", message: `Unknown synthetic tool: ${name}` },
      };
    }
  }
  const ok = Object.values(tools).filter((t) => t.successful).length;
  return {
    tools,
    total_count: names.length,
    success_count: ok,
    error_count: names.length - ok,
    next_steps_guidance: ["Call AISA_BATCH_QUOTE with the same intended calls before AISA_BATCH_USE."],
  };
}

function quoteItem(call, caseId) {
  const tool = call.tool;
  const ticker = tickerOf(call);
  if (ticker === "FAIL") {
    return {
      call_id: call.call_id,
      tool,
      successful: false,
      error: { type: "quote_failed", message: "Synthetic quote failed for ticker FAIL." },
    };
  }
  if (caseId === "uncertain-cap" && tool === PROFILE) {
    return {
      call_id: call.call_id,
      tool,
      successful: true,
      request_id: `q_${call.call_id}`,
      data: {
        object: "cost_estimate",
        estimate_kind: "estimate",
        estimated_cost_micros_usd: 50000,
        may_exceed_estimate: true,
      },
    };
  }
  return {
    call_id: call.call_id,
    tool,
    successful: true,
    request_id: `q_${call.call_id}`,
    data: {
      object: "cost_estimate",
      estimate_kind: "exact",
      estimated_cost_micros_usd: 100,
      may_exceed_estimate: false,
      max_cost_micros_usd: 100,
    },
  };
}

function callItem(call) {
  const tool = call.tool;
  const ticker = tickerOf(call);
  const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
  if (ticker === "FAIL") {
    return {
      call_id: call.call_id,
      tool,
      successful: false,
      error: { type: "call_failed", message: "Synthetic call failed for ticker FAIL." },
    };
  }
  if (tool === PROFILE && ticker === "NVDA") {
    return {
      call_id: call.call_id,
      tool,
      successful: true,
      request_id: `c_${call.call_id}`,
      customer_cost_micros_usd: 100,
      data: { company: NVDA_COMPANY, ticker: "NVDA", fixture: true },
    };
  }
  if (tool === NOTE) {
    return {
      call_id: call.call_id,
      tool,
      successful: true,
      request_id: `c_${call.call_id}`,
      customer_cost_micros_usd: 100,
      data: { echoed: args.text, fixture: true },
    };
  }
  return {
    call_id: call.call_id,
    tool,
    successful: false,
    error: { type: "unknown_call", message: "Synthetic stub does not execute this call." },
  };
}

function batch(kind, reqBody, caseId) {
  const calls = Array.isArray(reqBody.calls) ? reqBody.calls : [];
  const results = calls.map((call) => (kind === "quote" ? quoteItem(call, caseId) : callItem(call)));
  const ok = results.filter((r) => r.successful).length;
  return {
    batch_id: `${kind}_${caseId}`,
    search_id: reqBody.search_id,
    total_count: results.length,
    success_count: ok,
    error_count: results.length - ok,
    results,
    next_steps_guidance:
      kind === "quote"
        ? ["AISA_BATCH_QUOTE is a price observation. Do not call AISA_BATCH_USE without explicit approval."]
        : [],
  };
}

function catalogCategory() {
  return {
    apis: [{ id: "eval-synth-legacy", endpoint_count: 1, is_active: true }],
  };
}

function catalogDetail() {
  return {
    api: {
      id: "eval-synth-legacy",
      endpoint_count: 1,
      is_active: true,
      endpoint_groups: [
        {
          name: "default",
          endpoints: [
            {
              method: "GET",
              path: "/apis/v1/eval-synth-legacy/company",
              name: "legacy company catalog",
              description: "Old catalog keyword search fixture for company profile.",
            },
          ],
        },
      ],
    },
  };
}

export function startStub({ caseId }) {
  const ledger = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const raw = req.method === "POST" ? await readBody(req) : "";
    const body = raw ? parseJson(raw) : {};
    const hasAuth = Boolean(req.headers.authorization);
    let operation = "other";
    if (url.pathname === ROUTER.search) operation = "search";
    else if (url.pathname === ROUTER.schema) operation = "schema";
    else if (url.pathname === ROUTER.quote) operation = "quote";
    else if (url.pathname === ROUTER.call) operation = "call";
    else if (url.pathname.startsWith("/info/")) operation = "catalog";

    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      host: req.headers.host || "",
      operation,
      has_auth: hasAuth,
      body,
    };

    try {
      if (req.method === "GET" && url.pathname === "/info/apis/category") {
        entry.status = 200;
        ledger.push(entry);
        json(res, 200, catalogCategory());
        return;
      }
      if (req.method === "GET" && url.pathname === "/info/apis/eval-synth-legacy") {
        entry.status = 200;
        ledger.push(entry);
        json(res, 200, catalogDetail());
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/info/")) {
        entry.status = 200;
        ledger.push(entry);
        json(res, 200, {});
        return;
      }
      if (req.method !== "POST") {
        entry.status = 404;
        ledger.push(entry);
        json(res, 404, { error: "not found" });
        return;
      }
      if (operation === "quote" || operation === "call") {
        if (!hasAuth) {
          entry.status = 401;
          ledger.push(entry);
          json(res, 401, { code: "unauthenticated", message: "API key required" });
          return;
        }
      }
      if (operation === "search") {
        const payload = searchBody();
        entry.status = 200;
        entry.response = payload;
        ledger.push(entry);
        json(res, 200, payload);
        return;
      }
      if (operation === "schema") {
        const payload = schemaBody(body);
        entry.status = 200;
        entry.response = payload;
        ledger.push(entry);
        json(res, 200, payload);
        return;
      }
      if (operation === "quote" || operation === "call") {
        const payload = batch(operation, body, caseId);
        entry.status = 200;
        entry.results = payload.results;
        entry.response = payload;
        ledger.push(entry);
        json(res, 200, payload);
        return;
      }
      entry.status = 404;
      ledger.push(entry);
      json(res, 404, { error: "not found" });
    } catch (err) {
      entry.status = 500;
      entry.error = String(err);
      ledger.push(entry);
      json(res, 500, { error: "stub failure" });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        ledger,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}
