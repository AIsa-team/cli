import { readFileSync } from "node:fs";
import { usageError } from "../cli-error.js";

export type RouterKind = "search" | "schema" | "quote" | "call";

export interface RouterIoOptions {
  input?: string;
  file?: string;
  json?: boolean;
  limit?: string;
  provider?: string[];
  includeArgumentsSchema?: boolean;
  includeResponseSchema?: boolean;
}

export interface PreparedRequest {
  /** Raw application JSON sent to Router. */
  body: string;
  /** Parsed envelope for local validation and human rendering only. */
  value: Record<string, unknown>;
}

/**
 * Resolve one request body from operands, --input, or -f.
 * Conflicting sources are a usage error and must not dispatch.
 */
export async function prepareRouterRequest(
  kind: RouterKind,
  operands: string[],
  options: RouterIoOptions
): Promise<PreparedRequest> {
  const hasInput = options.input !== undefined;
  const hasFile = options.file !== undefined;
  const hasOperands = operands.length > 0;

  if (hasInput && hasFile) {
    throw usageError("Use either --input or -f/--file, not both");
  }

  if ((hasInput || hasFile) && hasOperands) {
    throw usageError("Do not combine positional arguments with --input or -f/--file");
  }

  if ((hasInput || hasFile) && hasSupplementalFlags(kind, options)) {
    throw usageError("Do not combine --input/-f with field flags; put every field in the JSON request");
  }

  if (hasInput) {
    return fromEnvelope(kind, options.input as string, " --input");
  }
  if (hasFile) {
    return fromEnvelope(kind, await readRequestFile(options.file as string), ` -f ${options.file}`);
  }

  if (kind === "search") {
    return buildSearch(operands, options);
  }
  if (kind === "schema") {
    return buildSchema(operands, options);
  }

  throw usageError(`${kind} requires --input '<json>' or -f FILE (use -f - for stdin)`);
}

async function readRequestFile(path: string): Promise<string> {
  if (path === "-") {
    if (process.stdin.isTTY) {
      throw usageError("No JSON on stdin. Pipe a request or pass -f FILE");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    throw usageError(`Cannot read ${path}: ${(err as Error).message}`);
  }
}

function fromEnvelope(kind: RouterKind, raw: string, source: string): PreparedRequest {
  const text = raw.trim();
  if (!text) {
    throw usageError(`Empty JSON request from${source}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw usageError(`Invalid JSON from${source}`);
  }

  if (!isPlainObject(value)) {
    throw usageError(`Request from${source} must be a JSON object`);
  }

  validateEnvelope(kind, value);
  // Send the original text so numeric tokens in arguments are not rewritten.
  return { body: text, value };
}

function buildSearch(operands: string[], options: RouterIoOptions): PreparedRequest {
  if (operands.length !== 1 || !operands[0].trim()) {
    throw usageError("search requires a query, --input '<json>', or -f FILE");
  }

  const request: Record<string, unknown> = { query: operands[0] };

  if (options.limit !== undefined) {
    request.limit = parseLimit(options.limit);
  }
  if (options.provider && options.provider.length > 0) {
    request.provider_filters = options.provider;
  }

  validateEnvelope("search", request);
  return { body: JSON.stringify(request), value: request };
}

function buildSchema(operands: string[], options: RouterIoOptions): PreparedRequest {
  const tools = operands.map((t) => t.trim()).filter(Boolean);
  if (tools.length === 0) {
    throw usageError("schema requires one or more tool names, --input '<json>', or -f FILE");
  }

  const request: Record<string, unknown> = { tools };
  // Only send include_* when the caller set them so server defaults remain.
  if (options.includeArgumentsSchema === false) {
    request.include_arguments_schema = false;
  }
  if (options.includeResponseSchema === true) {
    request.include_response_schema = true;
  }
  if (options.includeArgumentsSchema === false && options.includeResponseSchema !== true) {
    throw usageError("At least one of arguments or response schema must be requested");
  }

  validateEnvelope("schema", request);
  return { body: JSON.stringify(request), value: request };
}

function parseLimit(raw: string): number {
  if (!/^[1-9]\d*$/.test(raw)) {
    throw usageError("limit must be an integer from 1 to 20");
  }
  const n = Number(raw);
  if (n < 1 || n > 20) {
    throw usageError("limit must be an integer from 1 to 20");
  }
  return n;
}

const SEARCH_KEYS = ["query", "known_fields", "provider_filters", "limit"];
const SCHEMA_KEYS = ["tools", "include_arguments_schema", "include_response_schema"];
const BATCH_KEYS = ["search_id", "calls"];
const CALL_KEYS = ["call_id", "tool", "arguments"];

export function validateEnvelope(kind: RouterKind, value: Record<string, unknown>): void {
  if (kind === "search") {
    rejectUnknownKeys(value, SEARCH_KEYS, "search request");
    if (typeof value.query !== "string" || value.query.trim().length === 0) {
      throw usageError("search request requires a non-empty query string");
    }
    if (value.query.length > 2000) {
      throw usageError("query must be at most 2000 characters");
    }
    if (value.known_fields !== undefined && !isPlainObject(value.known_fields)) {
      throw usageError("known_fields must be a JSON object");
    }
    if (value.provider_filters !== undefined) {
      if (!isStringArray(value.provider_filters)) {
        throw usageError("provider_filters must be an array of strings");
      }
      if (value.provider_filters.length > 50) {
        throw usageError("provider_filters must have at most 50 entries");
      }
      if (new Set(value.provider_filters).size !== value.provider_filters.length) {
        throw usageError("provider_filters must be unique");
      }
    }
    if (value.limit !== undefined) {
      if (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 20) {
        throw usageError("limit must be an integer from 1 to 20");
      }
    }
    return;
  }

  if (kind === "schema") {
    rejectUnknownKeys(value, SCHEMA_KEYS, "schema request");
    if (!isStringArray(value.tools) || value.tools.length < 1 || value.tools.length > 20) {
      throw usageError("schema request requires tools: 1–20 non-empty strings");
    }
    if (new Set(value.tools).size !== value.tools.length) {
      throw usageError("schema tools must be unique");
    }
    if (value.tools.some((t) => t.trim().length === 0 || /\s/.test(t[0]) || /\s/.test(t[t.length - 1]))) {
      throw usageError("each tool name must be a non-empty string without surrounding whitespace");
    }
    const includeArgs = value.include_arguments_schema;
    const includeResp = value.include_response_schema;
    if (includeArgs !== undefined && typeof includeArgs !== "boolean") {
      throw usageError("include_arguments_schema must be a boolean");
    }
    if (includeResp !== undefined && typeof includeResp !== "boolean") {
      throw usageError("include_response_schema must be a boolean");
    }
    if (includeArgs === false && includeResp === false) {
      throw usageError("At least one of arguments or response schema must be requested");
    }
    return;
  }

  rejectUnknownKeys(value, BATCH_KEYS, "quote/call request");
  if (!Array.isArray(value.calls) || value.calls.length < 1 || value.calls.length > 20) {
    throw usageError("quote/call request requires calls: 1–20 items");
  }
  if (value.search_id !== undefined && typeof value.search_id !== "string") {
    throw usageError("search_id must be a string");
  }
  const callIds: string[] = [];
  for (const [i, call] of value.calls.entries()) {
    if (!isPlainObject(call)) {
      throw usageError(`calls[${i}] must be an object`);
    }
    rejectUnknownKeys(call, CALL_KEYS, `calls[${i}]`);
    if (typeof call.call_id !== "string" || call.call_id.length < 1 || call.call_id.length > 128) {
      throw usageError(`calls[${i}].call_id must be a string of 1–128 characters`);
    }
    if (typeof call.tool !== "string" || call.tool.length < 1) {
      throw usageError(`calls[${i}].tool must be a non-empty string`);
    }
    if (!isPlainObject(call.arguments)) {
      throw usageError(`calls[${i}].arguments must be a JSON object`);
    }
    callIds.push(call.call_id);
  }
  if (new Set(callIds).size !== callIds.length) {
    throw usageError("call_id values must be unique within the batch");
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw usageError(`${label} has unknown field(s): ${extra.join(", ")}`);
  }
}

function hasSupplementalFlags(kind: RouterKind, options: RouterIoOptions): boolean {
  if (kind === "search") {
    return options.limit !== undefined || (options.provider !== undefined && options.provider.length > 0);
  }
  if (kind === "schema") {
    return options.includeArgumentsSchema !== undefined || options.includeResponseSchema !== undefined;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
