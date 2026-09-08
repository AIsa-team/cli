import { MCP_CLI_MAP } from "../cli-guidance.js";
import type { RouterOperation } from "../router.js";

/** Published catalog tool whose schema includes `ticker`. Used only in examples. */
export const EXAMPLE_PUBLISHED_TOOL = "get_financial_company_facts";

export const EXAMPLE_SEARCH = { query: "company facts" };
export const EXAMPLE_SEARCH_LIMIT = { query: "company facts", limit: 5 };
/** Inline JSON with an apostrophe and Unicode; no file required. */
export const EXAMPLE_SEARCH_QUOTED = {
  query: "company facts",
  known_fields: { name: "O'Reilly — 苹果" },
};
export const EXAMPLE_SCHEMA = { tools: [EXAMPLE_PUBLISHED_TOOL] };
export const EXAMPLE_BATCH = {
  calls: [
    {
      call_id: "c1",
      tool: EXAMPLE_PUBLISHED_TOOL,
      arguments: { ticker: "AAPL" },
    },
  ],
};

export const EXAMPLE_SEARCH_JSON = JSON.stringify(EXAMPLE_SEARCH);
export const EXAMPLE_SEARCH_LIMIT_JSON = JSON.stringify(EXAMPLE_SEARCH_LIMIT);
export const EXAMPLE_SEARCH_QUOTED_JSON = JSON.stringify(EXAMPLE_SEARCH_QUOTED);
export const EXAMPLE_SCHEMA_JSON = JSON.stringify(EXAMPLE_SCHEMA);
export const EXAMPLE_BATCH_JSON = JSON.stringify(EXAMPLE_BATCH);

export const ROUTER_EXITS = {
  "0": "success",
  "2": "invalid local input (nothing sent)",
  "1": "transport, auth, or HTTP error",
  "3": "HTTP 200 with any failed batch item",
} as const;

export interface RouterExample {
  argv: string[];
  input?: Record<string, unknown>;
}

export interface RouterCommandContract {
  auth: "optional" | "required";
  sameRequestShapeAs?: "quote" | "call";
  flow: string;
  safety: string[];
  examples: RouterExample[];
}

export interface RouterRootContract {
  operations: Record<RouterOperation, { identifier: string; path: string; auth: "optional" | "required" }>;
  flow: string;
  safety: string[];
  exits: typeof ROUTER_EXITS;
  legacy: {
    deprecated: string[];
    unchanged: string[];
    note: string;
  };
}

const FLOW =
  "Discover with aisa search → aisa schema when has_full_schema=false → aisa quote → aisa call only after a matching quote and explicit approval covering that cost and uncertainty.";

const INLINE =
  "--input is inline JSON text (no file required). The CLI parses the argument as given, including apostrophes and Unicode; quote it so the shell does not eat characters. -f FILE and -f - remain available.";

const JSON_CONTRACT =
  "--json writes the unmodified application body, including MCP identifiers and numeric tokens. Human output maps only AISA_SEARCH_TOOL, AISA_BATCH_GET_SCHEMA, AISA_BATCH_QUOTE, and AISA_BATCH_USE to aisa search / schema / quote / call.";

const SHARED_KEY =
  "quote and call require AISA_API_KEY (same key as aisa login and aisa run). search and schema may be anonymous.";

const EXITS =
  "Exits: 0 success; 2 invalid local input (nothing sent); 1 transport, auth, or HTTP error; 3 HTTP 200 with any failed batch item.";

const ROOT_SAFETY = [
  "Quote is a price observation, not authorization to execute. A data request or credentials alone is not spending approval.",
  "Do not invent tool names. Do not guess required unresolved values; ask, and do not call.",
  "A missing or failed quote is never free. Unquoted calls cannot be executed. Estimated cost is not a limit.",
  "If a hard monetary cap is required, do not execute calls that have no guaranteed maximum.",
  "A partial quote is not a full-batch total. Call only an independently approved successful subset. Do not silently retry or expand the set.",
  "Without AISA_API_KEY, search and schema may be anonymous; quote and call will not run. Do not invent a business result.",
];

function example(kind: RouterOperation, input: Record<string, unknown>): RouterExample {
  return { argv: [kind, "--input", JSON.stringify(input), "--json"], input };
}

export function routerContract(kind: RouterOperation): RouterCommandContract {
  switch (kind) {
    case "search":
      return {
        auth: "optional",
        flow: FLOW,
        safety: [
          SHARED_KEY,
          "Do not invent tool names. Do not guess required unresolved values; ask, and do not call.",
        ],
        examples: [
          example("search", EXAMPLE_SEARCH),
          example("search", EXAMPLE_SEARCH_LIMIT),
          example("search", EXAMPLE_SEARCH_QUOTED),
        ],
      };
    case "schema":
      return {
        auth: "optional",
        flow: `Use after search when has_full_schema=false. Pass exact tool names from search. ${EXAMPLE_PUBLISHED_TOOL} is a published tool whose schema includes ticker.`,
        safety: [
          SHARED_KEY,
          "Do not invent tool names. Do not guess arguments; read the returned schema.",
        ],
        examples: [example("schema", EXAMPLE_SCHEMA)],
      };
    case "quote":
      return {
        auth: "required",
        sameRequestShapeAs: "call",
        flow: FLOW,
        safety: [
          SHARED_KEY,
          "Same request shape as aisa call.",
          "Quote does not execute. Quote is not authorization to execute.",
          "A data request or credentials alone is not spending approval.",
          "A missing or failed quote is never free. Unquoted calls cannot be executed.",
          "Estimated cost is not a limit. If a hard monetary cap is required, do not execute calls that have no guaranteed maximum.",
          "A partial quote is not a full-batch total. Do not treat a successful-subset subtotal as the full-batch total.",
        ],
        examples: [example("quote", EXAMPLE_BATCH)],
      };
    case "call":
      return {
        auth: "required",
        sameRequestShapeAs: "quote",
        flow: FLOW,
        safety: [
          SHARED_KEY,
          "Same request shape as aisa quote. Re-quote if tools, arguments, or scope change.",
          "aisa call is billable and needs a matching quote plus explicit approval covering that cost and any uncertainty.",
          "A missing or failed quote is never free. Unquoted calls cannot be executed.",
          "A data request or credentials alone is not spending approval.",
          "Call only an independently approved successful subset. Do not silently retry or expand the set.",
          "Without a key, do not invent a business result.",
        ],
        examples: [example("call", EXAMPLE_BATCH)],
      };
  }
}

export function routerRootContract(): RouterRootContract {
  return {
    operations: {
      search: { ...MCP_CLI_MAP.search, auth: "optional" },
      schema: { ...MCP_CLI_MAP.schema, auth: "optional" },
      quote: { ...MCP_CLI_MAP.quote, auth: "required" },
      call: { ...MCP_CLI_MAP.call, auth: "required" },
    },
    flow: FLOW,
    safety: ROOT_SAFETY,
    exits: ROUTER_EXITS,
    legacy: {
      deprecated: ["api search", "api show", "run"],
      unchanged: ["api list", "api code"],
      note: "Deprecated commands are not drop-in replacements. Removal will be a separately announced breaking release.",
    },
  };
}

export function routerContractFor(name: string): RouterCommandContract | undefined {
  if (name === "search" || name === "schema" || name === "quote" || name === "call") {
    return routerContract(name);
  }
  return undefined;
}

function mcpLine(kind: RouterOperation): string {
  const op = MCP_CLI_MAP[kind];
  return `MCP: ${op.identifier} → ${op.cli} (POST ${op.path})`;
}

/** Shell-safe --input flag. Apostrophes use a double-quoted JSON string. */
export function shellInputFlag(json: string): string {
  if (json.includes("'")) return `--input ${JSON.stringify(json)}`;
  return `--input '${json}'`;
}

function humanExamples(kind: RouterOperation, extras: string[]): string {
  const lines = [...extras];
  for (const ex of routerContract(kind).examples) {
    if (ex.input) lines.push(`  $ aisa ${kind} ${shellInputFlag(JSON.stringify(ex.input))} --json`);
  }
  lines.push(`  $ aisa ${kind} -f request.json --json`);
  lines.push(`  $ aisa ${kind} -f - --json < request.json`);
  return lines.join("\n");
}

function helpBody(kind: RouterOperation, extras: string[]): string {
  const c = routerContract(kind);
  return `
${mcpLine(kind)}
${JSON_CONTRACT}

${c.flow}
${c.safety.join("\n")}
${INLINE}

Examples:
${humanExamples(kind, extras)}

${EXITS}
Machine readers: aisa manifest ${kind}
`;
}

export function searchHelpAfter(): string {
  return helpBody("search", [`  $ aisa search "company facts" --json`]);
}

export function schemaHelpAfter(): string {
  return helpBody("schema", [`  $ aisa schema ${EXAMPLE_PUBLISHED_TOOL} --json`]);
}

export function quoteHelpAfter(): string {
  return helpBody("quote", []);
}

export function callHelpAfter(): string {
  return helpBody("call", []);
}

export function rootHelpAfter(): string {
  const root = routerRootContract();
  return `
Examples:
  $ aisa connect                      wire your coding agent to AIsa (start here)
  $ aisa search "company facts" --json
  $ aisa schema ${EXAMPLE_PUBLISHED_TOOL} --json
  $ aisa quote ${shellInputFlag(EXAMPLE_BATCH_JSON)} --json
  $ aisa call ${shellInputFlag(EXAMPLE_BATCH_JSON)} --json
  $ aisa twitter search "ai" --raw    search X, full JSON out

Router: ${MCP_CLI_MAP.search.identifier}→search, ${MCP_CLI_MAP.schema.identifier}→schema, ${MCP_CLI_MAP.quote.identifier}→quote, ${MCP_CLI_MAP.call.identifier}→call.
--json keeps MCP identifiers. Human output maps those four names to CLI commands.
${SHARED_KEY}
${root.safety.join("\n")}
${INLINE}
${EXITS}
Command --help has file/stdin examples. aisa manifest includes the MCP mapping and safety fields.

Deprecated (stdout unchanged; not drop-in replacements; removal announced later):
  $ aisa api search "insider trades"  old catalog keyword search; contract differs from aisa search
  $ aisa api show coingecko           provider catalog browse; not equivalent to aisa schema
  $ aisa run coingecko simple/price -q ids=bitcoin -q vs_currencies=usd   raw routing; not aisa call
api list, api code, and specialized commands are unchanged.
`;
}
