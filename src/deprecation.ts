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
      "aisa search uses Router retrieval and a different result contract. Use api search only when you need the old catalog keyword search. Removal will be a separately announced breaking release.",
    warning:
      "deprecated: aisa api search — use aisa search (Router results; contract differs). Removal will be announced separately.",
  },
  {
    path: "api show",
    replacement: "schema",
    migration:
      "aisa schema inspects published Router tools. Provider-wide catalog browsing is not equivalent. Removal will be a separately announced breaking release.",
    warning:
      "deprecated: aisa api show — prefer aisa schema for published tools. Removal will be announced separately.",
  },
  {
    path: "run",
    replacement: "call",
    migration:
      "aisa call is only for published Router tools. run still performs raw provider and LLM routing. Removal will be a separately announced breaking release.",
    warning:
      "deprecated: aisa run — prefer aisa call for published Router tools. Removal will be announced separately.",
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
