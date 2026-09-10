#!/usr/bin/env node

import { Command, Option } from "commander";
import { VERSION } from "./constants.js";
import { CliError } from "./cli-error.js";
import type { RouterIoOptions } from "./commands/tool-input.js";

// Auth
import { loginAction, logoutAction, whoamiAction } from "./commands/auth.js";
import { loginHelpAfter } from "./commands/oauth-login.js";
// Account
import { balanceAction, topupAction, usageAction } from "./commands/account.js";
// API
import { apiListAction, apiShowAction } from "./commands/api.js";
// Chat
import { chatAction } from "./commands/chat.js";
// Models
import { modelsListAction, modelsShowAction } from "./commands/models.js";
// Search
import { searchAction, schemaAction, quoteAction, callAction } from "./commands/tools.js";
import {
  callHelpAfter,
  quoteHelpAfter,
  rootHelpAfter,
  schemaHelpAfter,
  searchHelpAfter,
} from "./commands/tool-help.js";
// Skills
import {
  skillsListAction, skillsSearchAction, skillsShowAction,
  skillsInstallAction, skillsRemoveAction, skillsInitAction,
} from "./commands/skills.js";
// MCP
import { mcpSetupAction, mcpStatusAction } from "./commands/mcp.js";
import { connectAction } from "./commands/connect.js";
// Update
import { updateAction } from "./commands/update.js";
import { announceUpdate } from "./utils/update-check.js";
// Config
import { configSetAction, configGetAction, configListAction, configResetAction } from "./commands/configCmd.js";
// Cache
import { cacheClearAction, cachePathAction } from "./commands/cacheCmd.js";
// Completion
import { completionAction, completeAction } from "./commands/completionCmd.js";
// Manifest
import { manifestAction } from "./commands/manifest.js";
import { serveResultsAction } from "./commands/serve-results.js";
import { serveSignInAction } from "./commands/serve-signin.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrap(fn: (...args: any[]) => Promise<void>): (...args: any[]) => void {
  return (...args) => {
    fn(...args)
      // After the command, never before: the thing the user asked for is what
      // should reach the screen first, and this is only ever a footnote.
      // announceUpdate is silent for a pipe, for an install it cannot update,
      // and whenever the answer is not already on disk within its budget.
      .then(() => announceUpdate())
      .catch((err: Error) => {
        const code = err instanceof CliError ? err.exitCode : 1;
        if (err.message) console.error(`Error: ${err.message}`);
        process.exit(code);
      });
  };
}

function collectProvider(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function routerIo(opts: Record<string, unknown>): RouterIoOptions {
  return {
    input: opts.input as string | undefined,
    file: opts.file as string | undefined,
    json: Boolean(opts.json),
    limit: opts.limit as string | undefined,
    provider: opts.provider as string[] | undefined,
    includeArgumentsSchema: opts.argumentsSchema === false ? false : undefined,
    includeResponseSchema: opts.includeResponseSchema === true ? true : undefined,
  };
}

const program = new Command();

program
  .name("aisa")
  .description("AIsa CLI - Unified AI infrastructure platform")
  .version(VERSION);

// ── Auth ──

program
  .command("login")
  .description("Sign in to AIsa — browser sign-in by default, or --key to paste one")
  .option("--key <key>", "API key (skips the browser sign-in)")
  .option("--no-browser", "Print the sign-in URL and paste the redirect back (detected on its own over SSH)")
  .addHelpText("after", loginHelpAfter())
  .action(wrap(loginAction));

program
  .command("logout")
  .description("Revoke OAuth refresh token and remove stored credentials")
  .action(logoutAction);

program
  .command("whoami")
  .description("Show authentication status")
  .action(whoamiAction);

// ── Account ──

program
  .command("topup [amount]")
  .description("Add credit — opens the console billing page (amount in USD, optional)")
  .option("--no-open", "Print the URL instead of opening the browser")
  .action(topupAction);

program
  .command("balance")
  .description("Show credit balance")
  .option("--json", "Output raw JSON")
  .action(wrap(balanceAction));

program
  .command("usage")
  .description("Show usage history (awaiting gateway support)")
  .option("--limit <n>", "Max records")
  .option("--days <n>", "Lookback days")
  .action(wrap(usageAction));

// ── Tool Router (same operations as MCP) ──

program
  .command("search [query]")
  .description("Discover published tools via the Tool Router (MCP AISA_SEARCH_TOOL)")
  .option("--input <json>", "Inline JSON request body (no file required)")
  .option("-f, --file <path>", "Read JSON request from file, or - for stdin")
  .option("--limit <n>", "Max additional discovery results (1-20)")
  .option("--provider <id>", "Exact catalog provider key (repeatable)", collectProvider, [] as string[])
  .option("--json", "Write the unmodified application response to stdout (MCP identifiers unchanged)")
  .addHelpText("after", searchHelpAfter())
  .action((query: string | undefined, opts: Record<string, unknown>) =>
    wrap(searchAction)(query, routerIo(opts))
  );

program
  .command("schema [tools...]")
  .description("Get published tool schemas via the Tool Router (MCP AISA_BATCH_GET_SCHEMA)")
  .option("--input <json>", "Inline JSON request body (no file required)")
  .option("-f, --file <path>", "Read JSON request from file, or - for stdin")
  .option("--no-arguments-schema", "Omit arguments_schema (at least one schema type is required)")
  .option("--include-response-schema", "Include response_schema")
  .option("--json", "Write the unmodified application response to stdout (MCP identifiers unchanged)")
  .addHelpText("after", schemaHelpAfter())
  .action((tools: string[] | undefined, opts: Record<string, unknown>) =>
    wrap(schemaAction)(tools, routerIo(opts))
  );

program
  .command("quote")
  .description("Quote published tools via the Tool Router without executing them (MCP AISA_BATCH_QUOTE)")
  .option("--input <json>", "Inline JSON request body, same shape as call (no file required)")
  .option("-f, --file <path>", "Read JSON request from file, or - for stdin")
  .option("--json", "Write the unmodified application response to stdout (MCP identifiers unchanged)")
  .addHelpText("after", quoteHelpAfter())
  .action((opts: Record<string, unknown>) => wrap(quoteAction)(routerIo(opts)));

program
  .command("call")
  .description("Execute published tools via the Tool Router (MCP AISA_BATCH_USE)")
  .option("--input <json>", "Inline JSON request body, same shape as quote (no file required)")
  .option("-f, --file <path>", "Read JSON request from file, or - for stdin")
  .option("--json", "Write the unmodified application response to stdout (MCP identifiers unchanged)")
  .addHelpText("after", callHelpAfter())
  .action((opts: Record<string, unknown>) => wrap(callAction)(routerIo(opts)));

// ── API ──

const api = program.command("api").description("Browse the read-only provider and endpoint catalog");

api
  .command("list")
  .description("List available APIs")
  .option("--category <cat>", "Filter by category (client-side grouping): finance, search, social, productivity, other")
  .option("--health", "Include provider health status")
  .option("--json", "Output raw JSON")
  .option("--refresh", "Bypass the cached catalog")
  .action(wrap(apiListAction));

api
  .command("show <api> [path]")
  .description("Show an API's endpoints, or one endpoint's details")
  .option("--all", "Show every endpoint instead of the first 40")
  .option("--group", "Group by the provider's raw endpoint groups")
  .option("--health", "Include provider health status")
  .option("--json", "Output raw JSON")
  .option("--refresh", "Bypass the cached catalog")
  .action(wrap(apiShowAction));

// ── Chat (LLM Gateway) ──

program
  .command("chat [message]")
  .description("Chat with AI models via the AIsa gateway")
  .option("--model <model>", "Model ID (default: gpt-4.1-mini)")
  .option("--system <prompt>", "System prompt")
  .option("--no-stream", "Disable streaming")
  .option("--json", "Output raw JSON response")
  .option("--max-tokens <n>", "Max output tokens")
  .option("--temperature <t>", "Sampling temperature (0-2)")
  .action(wrap(chatAction));

// ── Models ──

const models = program.command("models").description("Browse available LLM models");

models
  .command("list", { isDefault: true })
  .description("List all models")
  .option("--provider <provider>", "Filter by provider")
  .action(wrap(modelsListAction));

models
  .command("show <model-id>")
  .description("Show model details and pricing")
  .action(wrap(modelsShowAction));

// ── Skills ──

const skills = program.command("skills").description("Browse and manage agent skills");

skills
  .command("list")
  .description("List available skills")
  .option("--category <cat>", "Filter by category (ai-models, financial, marketing, ...)")
  .option("--limit <n>", "Max results")
  .option("--refresh", "Bypass the cached skill index")
  .action(wrap(skillsListAction));

skills
  .command("search <query>")
  .description("Search skills by keyword")
  .option("--limit <n>", "Max results")
  .option("--refresh", "Bypass the cached skill index")
  .action(wrap(skillsSearchAction));

skills
  .command("show <slug>")
  .description("Show skill details")
  .action(wrap(skillsShowAction));

skills
  .command("install <slug>")
  .description("Install a skill to agent directories")
  .option("--agent <agent>", "Target agent: claude, cursor, copilot, windsurf, codex, gemini, openclaw, all")
  .option("--force", "Overwrite a directory holding a different skill")
  .action(wrap(skillsInstallAction));

skills
  .command("remove <slug>")
  .description("Remove an installed skill")
  .option("--agent <agent>", "Target agent")
  .option("--force", "Remove even if the directory holds a different skill")
  .action(skillsRemoveAction);

skills
  .command("init <name>")
  .description("Initialize a new skill from template")
  .option("--template <template>", "Template: llm, search, finance, twitter, video")
  .option("--bare", "Minimal template")
  .action(skillsInitAction);

// ── MCP ──

// Top-level so the zero-install one-liner works: `npx @aisa-one/cli connect`.
program
  .command("connect")
  .description("Connect AIsa MCP servers to your local coding agents via a one-shot local page")
  .option("--no-open", "Print the URL instead of opening the browser")
  .option("--port <port>", "Bind a specific port (default: random)")
  .option("--dry-run", "Show what would be configured without writing anything")
  .option("--template <id>", "Page template: t2 (guided steps, default) or t1 (classic two-page)")
  .option("--force", "Start a new run even if another one is still open")
  .option("--lang <lang>", "Page and terminal language: en or zh (default: your system locale)")
  .option("--headless", "Skip the page entirely (a machine without a browser is detected on its own)")
  // Hidden: how a run that was interrupted at the terminal picks itself back
  // up in a detached process, so the page it opened keeps working.
  .addOption(new Option("--resume <file>").hideHelp())
  .action(wrap(connectAction));

program
  .command("update")
  .description("Update the AIsa CLI to the latest published version")
  .action(wrap(updateAction));

const mcp = program.command("mcp").description("MCP server integration");

mcp
  .command("setup")
  .description("Configure AIsa MCP servers (from the live manifest) for AI agents")
  .option("--agent <agent>", "Target agent: cursor, claude-desktop, all")
  .option("--all", "Configure every live server, not just the default set")
  .option("--yes", "Write the files. Without it, print what would change and stop")
  .action(mcpSetupAction);

mcp
  .command("status")
  .description("Check MCP configuration and ping each configured endpoint")
  .action(mcpStatusAction);

// ── Config ──

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a config value")
  .action(configSetAction);

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action(configGetAction);

configCmd
  .command("list")
  .description("List all config values")
  .action(configListAction);

configCmd
  .command("reset")
  .description("Reset config to defaults")
  .action(configResetAction);

const cache = program.command("cache").description("Manage the local catalog and skills cache");

cache
  .command("clear")
  .description("Delete all cached catalog and skills data")
  .action(cacheClearAction);

cache
  .command("path")
  .description("Print the cache directory")
  .action(cachePathAction);

// ── Shell completion ──

// The whole tree as JSON. Agents get one shot at a top-level dump, and the
// default help renders every subcommand as a bare `[options]`.
// Hidden: started by `connect` when the user asks for the terminal back but
// the results page should outlive it. Serves that one page and nothing else.
program
  .command("__serve-results <file>", { hidden: true })
  .action(wrap(serveResultsAction));

// Hidden: started by `login` so the page the browser landed on survives a
// refresh after the terminal has been handed back.
program
  .command("__serve-signin <port> <until>", { hidden: true })
  .action(wrap(serveSignInAction));

program
  .command("manifest [command...]")
  .description("Print commands, arguments and flags as JSON (for agents and scripts)")
  .action((path: string[] = []) => manifestAction(program, path));

program
  .command("completion [shell]")
  .description("Print a shell completion script (bash, zsh, fish)")
  .action(completionAction);

// Called by the generated scripts on every Tab press. Hidden, and tolerant of
// whatever half-typed input the shell hands it.
program
  .command("__complete [words...]", { hidden: true })
  .allowUnknownOption()
  .allowExcessArguments()
  .action((words: string[] = []) => completeAction(program, words));

/**
 * Point every help page at the manifest.
 *
 * Not the flags themselves: `git`, `docker`, `gh` and `npm` all list
 * subcommands as name-plus-description, because that page's job is choosing a
 * command, not calling one. Printing flags there breaks a convention every
 * developer has a reflex for, and would still be truncated on the longest
 * entries — so a reader who needs the full set has to drill in anyway.
 *
 * One line is enough for the reader who cannot drill in cheaply. Given only
 * `aisa --help`, an LLM invented `--json` (the flag is `--raw`); given the
 * same page plus this line, it ran `aisa manifest` first instead of guessing,
 * saying outright that guessing risked an error. Measured 2026-08-24.
 */
function applyHelpStyle(cmd: Command): void {
  if (cmd.commands.length > 0) {
    // Advertise the narrow form: the whole tree is ~15k tokens, one subtree
    // is a fraction of that, and an agent reads whichever it is shown.
    const scope = cmd.parent ? ` ${cmd.name()}` : " [command]";
    cmd.addHelpText(
      "after",
      `\nAgents: \`aisa manifest${scope}\` prints these commands, arguments and flags as JSON.`
    );
  }
  for (const c of cmd.commands) applyHelpStyle(c);
}
program.addHelpText("after", rootHelpAfter());

// Last, after the human-facing examples: it is the line an agent scanning to
// the end of the page will find.
applyHelpStyle(program);

// ── Parse ──

program.parse();
