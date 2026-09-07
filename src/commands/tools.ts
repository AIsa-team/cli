import ora from "ora";
import chalk from "chalk";
import { getApiKey, requireApiKey } from "../config.js";
import { CliError, EXIT_PARTIAL, EXIT_TRANSPORT, transportError } from "../cli-error.js";
import { routerPost, type RouterOperation } from "../router.js";
import { error as printError } from "../utils/display.js";
import {
  prepareRouterRequest,
  type RouterIoOptions,
  type RouterKind,
} from "./tool-input.js";

export async function searchAction(query: string | undefined, options: RouterIoOptions): Promise<void> {
  const operands = query ? [query] : [];
  await runToolCommand("search", operands, options, { auth: "optional" });
}

export async function schemaAction(tools: string[] | undefined, options: RouterIoOptions): Promise<void> {
  await runToolCommand("schema", tools ?? [], options, { auth: "optional" });
}

export async function quoteAction(options: RouterIoOptions): Promise<void> {
  await runToolCommand("quote", [], options, { auth: "required" });
}

export async function callAction(options: RouterIoOptions): Promise<void> {
  await runToolCommand("call", [], options, { auth: "required" });
}

async function runToolCommand(
  kind: RouterKind,
  operands: string[],
  options: RouterIoOptions,
  auth: { auth: "optional" | "required" }
): Promise<void> {
  const prepared = await prepareRouterRequest(kind, operands, options);
  const apiKey = auth.auth === "required" ? requireApiKey() : getApiKey();

  const spinner = options.json ? undefined : ora(spinnerText(kind)).start();

  let result: { status: number; raw: string };
  try {
    result = await routerPost({
      operation: kind as RouterOperation,
      body: prepared.body,
      apiKey,
    });
  } catch (err) {
    spinner?.fail("Request failed");
    throw transportError((err as Error).message);
  }

  spinner?.stop();

  const applicationOk = result.status >= 200 && result.status < 300;
  if (options.json) {
    writeRawStdout(result.raw);
  } else if (applicationOk) {
    renderHuman(kind, result.raw);
  } else {
    printError(httpErrorMessage(result.status, result.raw));
    if (result.raw.trim()) {
      console.error(result.raw);
    }
  }

  if (!applicationOk) {
    throw new CliError("", EXIT_TRANSPORT);
  }

  if (batchHasFailure(result.raw)) {
    process.exitCode = EXIT_PARTIAL;
  }
}

function spinnerText(kind: RouterKind): string {
  switch (kind) {
    case "search":
      return "Searching published tools...";
    case "schema":
      return "Fetching tool schemas...";
    case "quote":
      return "Quoting published tools...";
    case "call":
      return "Calling published tools...";
  }
}

/** Unmodified application body. No parse/stringify round trip. */
export function writeRawStdout(raw: string): void {
  const text = raw.endsWith("\n") ? raw : raw + "\n";
  process.stdout.write(text);
}

function httpErrorMessage(status: number, raw: string): string {
  const code = rawFieldString(raw, "code");
  const message = rawFieldString(raw, "message");
  if (code && message) return `${status}: ${code}: ${message}`;
  if (message) return `${status}: ${message}`;
  return `${status}: Router request failed`;
}

/**
 * Partial batch: any failed item in a 200 envelope. Counts are small integers
 * so a structural parse is safe; the raw body has already been written for --json.
 */
export function batchHasFailure(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.error_count === "number" && value.error_count > 0) return true;
    if (Array.isArray(value.results)) {
      return value.results.some(
        (item) => isRecord(item) && item.successful === false
      );
    }
    if (isRecord(value.tools)) {
      return Object.values(value.tools).some(
        (item) => isRecord(item) && item.successful === false
      );
    }
  } catch {
    return false;
  }
  return false;
}

function renderHuman(kind: RouterKind, raw: string): void {
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      console.log(raw);
      return;
    }
    value = parsed;
  } catch {
    console.log(raw);
    return;
  }

  if (kind === "search") {
    renderSearch(value);
    return;
  }
  if (kind === "schema") {
    renderSchema(value);
    return;
  }
  renderBatch(kind, value, raw);
}

function renderSearch(value: Record<string, unknown>): void {
  if (typeof value.search_id === "string") {
    console.log(`\n  ${chalk.gray("search_id")} ${value.search_id}`);
  }

  const tools = Array.isArray(value.tools) ? value.tools : [];
  if (tools.length === 0) {
    console.log(`\n  ${chalk.yellow("No executable tools returned.")}`);
  }

  for (const item of tools) {
    if (!isRecord(item)) continue;
    const name = typeof item.tool === "string" ? item.tool : "(unknown tool)";
    const summary = typeof item.summary === "string" ? item.summary : "";
    const full = item.has_full_schema === true;
    console.log(`\n  ${chalk.cyan.bold(name)} ${chalk.gray(full ? "full schema" : "schema incomplete")}`);
    if (summary) console.log(`    ${summary}`);
    if (item.has_full_schema === false) {
      console.log(chalk.gray("    Next: aisa schema " + name));
    }
    if (isRecord(item.price)) {
      console.log(chalk.gray("    Price is catalog metadata — not an exact charge. Use --json for tokens."));
    }
  }

  printGuidance(value.next_steps_guidance);
  console.log();
}

function renderSchema(value: Record<string, unknown>): void {
  const tools = isRecord(value.tools) ? value.tools : {};
  console.log();
  for (const [name, item] of Object.entries(tools)) {
    if (!isRecord(item)) continue;
    if (item.successful === false) {
      const err = isRecord(item.error) ? item.error : {};
      const code = typeof err.code === "string" ? err.code : "error";
      const message = typeof err.message === "string" ? err.message : "lookup failed";
      console.log(`  ${chalk.red.bold(name)} failed (${code})`);
      console.log(`    ${message}`);
      continue;
    }
    console.log(`  ${chalk.cyan.bold(name)} ${chalk.green("ok")}`);
    if (item.arguments_schema !== undefined) {
      console.log(chalk.gray("    arguments_schema present — use --json for the contract"));
    }
    if (item.response_schema !== undefined) {
      console.log(chalk.gray("    response_schema present — use --json for the contract"));
    }
    printStringList("    pitfalls", item.known_pitfalls);
  }
  printCounts(value);
  printGuidance(value.next_steps_guidance);
  console.log();
}

function renderBatch(kind: RouterKind, value: Record<string, unknown>, raw: string): void {
  if (typeof value.batch_id === "string") {
    console.log(`\n  ${chalk.gray("batch_id")} ${value.batch_id}`);
  }

  const results = Array.isArray(value.results) ? value.results : [];
  for (const item of results) {
    if (!isRecord(item)) continue;
    const callId = typeof item.call_id === "string" ? item.call_id : "?";
    const tool = typeof item.tool === "string" ? item.tool : "?";
    const requestId = typeof item.request_id === "string" ? item.request_id : "";

    if (item.successful === false) {
      const err = isRecord(item.error) ? item.error : {};
      const type = typeof err.type === "string" ? err.type : "error";
      const message = typeof err.message === "string" ? err.message : "call failed";
      console.log(`\n  ${chalk.red.bold(callId)} ${tool} failed (${type})`);
      console.log(`    ${message}`);
      if (requestId) console.log(chalk.gray(`    request_id ${requestId}`));
      continue;
    }

    console.log(`\n  ${chalk.green.bold(callId)} ${tool}`);
    if (requestId) console.log(chalk.gray(`    request_id ${requestId}`));

    if (kind === "quote") {
      renderQuoteData(item.data, raw);
    } else {
      const charged = rawFieldNumberNear(raw, "customer_cost_micros_usd", callId);
      if (charged) {
        console.log(`    customer_cost_micros_usd ${charged} (as reported; not converted to dollars)`);
      } else {
        console.log(chalk.gray("    customer cost not reported — not treated as zero"));
      }
      console.log(chalk.gray("    result data: use --json for the unmodified payload"));
    }
  }

  printCounts(value);
  printGuidance(value.next_steps_guidance);
  if (kind === "quote") {
    console.log(chalk.gray("\n  Quote is a price observation, not authorization to execute."));
  }
  console.log();
}

function renderQuoteData(data: unknown, raw: string): void {
  if (!isRecord(data)) {
    console.log(chalk.gray("    quote data missing — not treated as zero"));
    return;
  }
  const kind = typeof data.estimate_kind === "string" ? data.estimate_kind : "unknown";
  const mayExceed = data.may_exceed_estimate === true;
  const estimated = rawFieldNumber(raw, "estimated_cost_micros_usd");
  const max = rawFieldNumber(raw, "max_cost_micros_usd");

  console.log(`    estimate_kind ${kind}${mayExceed ? " (may exceed estimate)" : ""}`);
  if (estimated) {
    console.log(`    estimated_cost_micros_usd ${estimated} (as reported; not an exact dollar price)`);
  } else {
    console.log(chalk.gray("    estimated cost not reported — not treated as zero"));
  }
  if (max) {
    console.log(`    max_cost_micros_usd ${max} (ceiling token, not converted)`);
  }
  if (kind === "estimate" || mayExceed) {
    console.log(chalk.gray("    This figure may be exceeded; do not treat it as a firm price."));
  }
}

function printCounts(value: Record<string, unknown>): void {
  const total = value.total_count;
  const ok = value.success_count;
  const err = value.error_count;
  if (typeof total === "number" || typeof ok === "number" || typeof err === "number") {
    console.log(`\n  ${ok ?? "?"} ok · ${err ?? "?"} failed · ${total ?? "?"} total`);
  }
}

function printGuidance(guidance: unknown): void {
  if (!Array.isArray(guidance) || guidance.length === 0) return;
  console.log(chalk.bold(`\n  Next steps`));
  for (const line of guidance) {
    if (typeof line === "string") console.log(`    ${line}`);
  }
}

function printStringList(label: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return;
  for (const line of value) {
    if (typeof line === "string") console.log(`${label}: ${line}`);
  }
}

export function rawFieldNumber(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`));
  return match?.[1];
}

function rawFieldNumberNear(raw: string, key: string, callId: string): string | undefined {
  const idx = raw.indexOf(`"call_id":"${callId}"`) >= 0
    ? raw.indexOf(`"call_id":"${callId}"`)
    : raw.indexOf(`"call_id": "${callId}"`);
  if (idx < 0) return rawFieldNumber(raw, key);
  const window = raw.slice(idx, idx + 2000);
  return rawFieldNumber(window, key);
}

function rawFieldString(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
