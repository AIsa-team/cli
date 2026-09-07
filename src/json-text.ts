/**
 * Parse application JSON while keeping number tokens as strings at their
 * structural locations. Strings are copied with escapes so digits inside
 * quotes are not treated as numbers.
 *
 * `--json` must keep using the original raw body; this is only for human
 * rendering and local inspection.
 */
export function parseJsonKeepingNumberTokens(source: string): unknown {
  return JSON.parse(quoteNumberTokens(source));
}

export function quoteNumberTokens(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"') {
      const copied = copyJsonString(source, i);
      out += copied.text;
      i = copied.end;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const match = source.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (match) {
        out += JSON.stringify(match[0]);
        i += match[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function copyJsonString(source: string, start: number): { text: string; end: number } {
  let i = start;
  let text = source[i++];
  while (i < source.length) {
    const c = source[i++];
    text += c;
    if (c === "\\" && i < source.length) {
      text += source[i++];
      continue;
    }
    if (c === '"') break;
  }
  return { text, end: i };
}

/** Exact token from a value produced by parseJsonKeepingNumberTokens. */
export function numberToken(value: unknown): string | undefined {
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toString() : undefined;
  }
  return undefined;
}
