import { ROUTER_PATHS, type RouterOperation } from "./router.js";

/**
 * Exact MCP operation identifiers → CLI command names.
 * Human presentation only. Do not apply to --json or tool result payloads.
 */
export const MCP_CLI_MAP: Record<
  RouterOperation,
  { identifier: string; cli: string; path: string }
> = {
  search: {
    identifier: "AISA_SEARCH_TOOL",
    cli: "aisa search",
    path: ROUTER_PATHS.search,
  },
  schema: {
    identifier: "AISA_BATCH_GET_SCHEMA",
    cli: "aisa schema",
    path: ROUTER_PATHS.schema,
  },
  quote: {
    identifier: "AISA_BATCH_QUOTE",
    cli: "aisa quote",
    path: ROUTER_PATHS.quote,
  },
  call: {
    identifier: "AISA_BATCH_USE",
    cli: "aisa call",
    path: ROUTER_PATHS.call,
  },
};

const REPLACEMENTS = Object.values(MCP_CLI_MAP)
  .map(({ identifier, cli }) => ({
    identifier,
    cli,
    pattern: new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "g"),
  }))
  .sort((a, b) => b.identifier.length - a.identifier.length);

/** Path after `aisa`, e.g. `search` — not a nested leaf like `api search`. */
export function mcpForCommand(commandPath: string): (typeof MCP_CLI_MAP)[RouterOperation] | undefined {
  if (
    commandPath === "search" ||
    commandPath === "schema" ||
    commandPath === "quote" ||
    commandPath === "call"
  ) {
    return MCP_CLI_MAP[commandPath];
  }
  return undefined;
}

/** Project the four exact MCP identifiers onto CLI names. Other text is unchanged. */
export function projectMcpIdentifiersToCli(text: string): string {
  let out = text;
  for (const { pattern, cli } of REPLACEMENTS) {
    out = out.replace(pattern, cli);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
