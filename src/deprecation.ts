export interface DeprecationMeta {
  /** Command path after `aisa`, e.g. "api search". */
  path: string;
  replacement: string;
  /**
   * Machine-readable migration note. No removal version or date — that
   * release will be announced separately.
   */
  migration: string;
  /** One-line stderr warning shown when the old command still runs. */
  warning: string;
}

export const DEPRECATED_COMMANDS: readonly DeprecationMeta[] = [
  {
    path: "api search",
    replacement: "search",
    migration:
      "Not a drop-in: aisa search is Router retrieval (AISA_SEARCH_TOOL) with a different result contract. Keep api search only for the old catalog keyword search. api list and api code are unchanged. Removal will be a separately announced breaking release.",
    warning:
      "deprecated: aisa api search — not a drop-in for aisa search (Router results; contract differs). Removal will be announced separately.",
  },
  {
    path: "api show",
    replacement: "schema",
    migration:
      "Not a drop-in: aisa schema is AISA_BATCH_GET_SCHEMA for published tool names. api show still browses a provider catalog by id/path and is not equivalent. Removal will be a separately announced breaking release.",
    warning:
      "deprecated: aisa api show — not equivalent to aisa schema (catalog id vs published tool name). Removal will be announced separately.",
  },
  {
    path: "run",
    replacement: "call",
    migration:
      "Not a drop-in: aisa call is AISA_BATCH_USE for published Router tools only. run still performs raw provider and LLM routing. Specialized commands are unchanged. Removal will be a separately announced breaking release.",
    warning:
      "deprecated: aisa run — not a drop-in for aisa call (raw routing vs published Router tools). Removal will be announced separately.",
  },
];

const byPath = new Map(DEPRECATED_COMMANDS.map((d) => [d.path, d]));

export function deprecationFor(path: string): DeprecationMeta | undefined {
  return byPath.get(path);
}

/** One stderr line. Does not touch stdout or result JSON. */
export function warnDeprecated(path: string): void {
  const meta = deprecationFor(path);
  if (!meta) return;
  console.error(meta.warning);
}

/** Run the original action after a stderr-only deprecation warning. */
export function withDeprecation<A extends unknown[], R>(
  path: string,
  fn: (...args: A) => R
): (...args: A) => R {
  return (...args: A) => {
    warnDeprecated(path);
    return fn(...args);
  };
}
