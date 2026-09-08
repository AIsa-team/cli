import { MCP_CLI_MAP } from "../cli-guidance.js";

/** Published catalog tool whose schema includes `ticker`. Used only in examples. */
export const EXAMPLE_PUBLISHED_TOOL = "get_financial_company_facts";

export const EXAMPLE_SEARCH = { query: "company facts" };
export const EXAMPLE_SEARCH_LIMIT = { query: "company facts", limit: 5 };
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
export const EXAMPLE_SCHEMA_JSON = JSON.stringify(EXAMPLE_SCHEMA);
export const EXAMPLE_BATCH_JSON = JSON.stringify(EXAMPLE_BATCH);

const EXITS =
  "Exits: 0 success; 2 invalid local input (nothing sent); 1 transport, auth, or HTTP error; 3 HTTP 200 with any failed batch item.";

const JSON_CONTRACT =
  "--json writes the unmodified application body, including MCP identifiers and numeric tokens. Human output maps only AISA_SEARCH_TOOL, AISA_BATCH_GET_SCHEMA, AISA_BATCH_QUOTE, and AISA_BATCH_USE to aisa search / schema / quote / call.";

const SHARED_KEY =
  "quote and call require AISA_API_KEY (same key as aisa login and aisa run). search and schema may be anonymous.";

const APPROVAL =
  "Quote is a price observation, not authorization to execute. A data request or credentials alone is not spending approval. aisa call is billable and needs a matching quote plus explicit approval covering that cost and any uncertainty. A missing or failed quote is never free. Estimated cost is not a limit.";

function mcpLine(kind: keyof typeof MCP_CLI_MAP): string {
  const op = MCP_CLI_MAP[kind];
  return `MCP: ${op.identifier} → ${op.cli} (POST ${op.path})`;
}

function ioExamples(command: string, inputJson: string): string {
  return `  $ aisa ${command} --input '${inputJson}' --json
  $ aisa ${command} -f request.json --json
  $ aisa ${command} -f - --json < request.json`;
}

export function searchHelpAfter(): string {
  return `
${mcpLine("search")}
${JSON_CONTRACT}

Discover a published tool, then aisa schema when has_full_schema=false, then aisa quote, then authorized aisa call.
${SHARED_KEY}

Examples (complete JSON; no invented tool names):
  $ aisa search "company facts" --json
${ioExamples("search", EXAMPLE_SEARCH_JSON)}
  $ aisa search --input '${EXAMPLE_SEARCH_LIMIT_JSON}' --json

${EXITS}
Machine readers: aisa manifest search
`;
}

export function schemaHelpAfter(): string {
  return `
${mcpLine("schema")}
${JSON_CONTRACT}

Use after search when has_full_schema=false. Pass exact tool names from search; do not invent names.
${EXAMPLE_PUBLISHED_TOOL} is a published tool whose schema includes ticker.
${SHARED_KEY}

Examples:
  $ aisa schema ${EXAMPLE_PUBLISHED_TOOL} --json
${ioExamples("schema", EXAMPLE_SCHEMA_JSON)}

${EXITS}
Machine readers: aisa manifest schema
`;
}

export function quoteHelpAfter(): string {
  return `
${mcpLine("quote")}
${JSON_CONTRACT}

Same request shape as aisa call. ${APPROVAL}
${SHARED_KEY}

Examples:
${ioExamples("quote", EXAMPLE_BATCH_JSON)}

${EXITS}
Machine readers: aisa manifest quote
`;
}

export function callHelpAfter(): string {
  return `
${mcpLine("call")}
${JSON_CONTRACT}

Same request shape as aisa quote. Re-quote if tools, arguments, or scope change.
${APPROVAL}
${SHARED_KEY}

Examples:
${ioExamples("call", EXAMPLE_BATCH_JSON)}

${EXITS}
Machine readers: aisa manifest call
`;
}

export function rootHelpAfter(): string {
  return `
Examples:
  $ aisa connect                      wire your coding agent to AIsa (start here)
  $ aisa search "company facts" --json
  $ aisa schema ${EXAMPLE_PUBLISHED_TOOL} --json
  $ aisa quote --input '${EXAMPLE_BATCH_JSON}' --json
  $ aisa call --input '${EXAMPLE_BATCH_JSON}' --json
  $ aisa twitter search "ai" --raw    search X, full JSON out

Router: ${MCP_CLI_MAP.search.identifier}→search, ${MCP_CLI_MAP.schema.identifier}→schema, ${MCP_CLI_MAP.quote.identifier}→quote, ${MCP_CLI_MAP.call.identifier}→call.
--json keeps MCP identifiers. Human output maps those four names to CLI commands.
${SHARED_KEY}
${APPROVAL}
${EXITS}
Command --help has file/stdin examples. aisa manifest <command> includes the MCP mapping.

Deprecated (stdout unchanged; not drop-in replacements; removal announced later):
  $ aisa api search "insider trades"  old catalog keyword search; contract differs from aisa search
  $ aisa api show coingecko           provider catalog browse; not equivalent to aisa schema
  $ aisa run coingecko simple/price -q ids=bitcoin -q vs_currencies=usd   raw routing; not aisa call
api list, api code, and specialized commands are unchanged.
`;
}
