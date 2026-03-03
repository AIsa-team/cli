#!/usr/bin/env node

import { Command } from "commander";
import { VERSION } from "./constants.js";

// Auth
import { loginAction, logoutAction, whoamiAction } from "./commands/auth.js";
// Account
import { balanceAction, usageAction } from "./commands/account.js";
// API
import { apiListAction, apiSearchAction, apiShowAction, apiCodeAction } from "./commands/api.js";
// Run
import { runAction } from "./commands/run.js";
// Chat
import { chatAction } from "./commands/chat.js";
// Models
import { modelsListAction, modelsShowAction } from "./commands/models.js";
// Search
import { webSearchAction, scholarAction } from "./commands/search.js";
// Finance
import { stockAction, cryptoAction, screenerAction } from "./commands/finance.js";
// Twitter
import { tweetAction, twitterSearchAction, twitterUserAction, twitterTrendsAction } from "./commands/twitter.js";
// Video
import { videoCreateAction, videoStatusAction } from "./commands/video.js";
// Skills
import {
  skillsListAction, skillsSearchAction, skillsShowAction,
  skillsAddAction, skillsRemoveAction, skillsUpdateAction,
  skillsInitAction, skillsSubmitAction, skillsPushAction, skillsVerifyAction,
} from "./commands/skills.js";
// MCP
import { mcpSetupAction, mcpStatusAction } from "./commands/mcp.js";
// Config
import { configSetAction, configGetAction, configListAction, configResetAction } from "./commands/configCmd.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrap(fn: (...args: any[]) => Promise<void>): (...args: any[]) => void {
  return (...args) => {
    fn(...args).catch((err: Error) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
  };
}

const program = new Command();

program
  .name("aisa")
  .description("AISA CLI - Unified AI infrastructure platform")
  .version(VERSION);

// ── Auth ──

program
  .command("login")
  .description("Authenticate with your AISA API key")
  .option("--key <key>", "API key")
  .action(loginAction);

program
  .command("logout")
  .description("Remove stored API key")
  .action(logoutAction);

program
  .command("whoami")
  .description("Show authentication status")
  .action(whoamiAction);

// ── Account ──

program
  .command("balance")
  .description("Show credit balance (WIP)")
  .action(wrap(balanceAction));

program
  .command("usage")
  .description("Show usage history (WIP)")
  .option("--limit <n>", "Max records")
  .option("--days <n>", "Lookback days")
  .action(wrap(usageAction));

// ── API ──

const api = program.command("api").description("Discover and inspect APIs (WIP)");

api
  .command("list")
  .description("List available API endpoints (WIP)")
  .option("--category <cat>", "Filter by category (llm, search, finance, twitter, video, scholar)")
  .action(wrap(apiListAction));

api
  .command("search <query>")
  .description("Search APIs by keyword (WIP)")
  .option("--limit <n>", "Max results")
  .action(wrap(apiSearchAction));

api
  .command("show <slug> [path]")
  .description("Show API endpoint details (WIP)")
  .action(wrap(apiShowAction));

api
  .command("code <slug> <path>")
  .description("Generate code snippet (WIP)")
  .option("--lang <language>", "Language: typescript, python, curl", "typescript")
  .action(wrap(apiCodeAction));

// ── Run ──

program
  .command("run <slug> <path>")
  .description("Execute an API call")
  .option("-q, --query <params...>", "Query parameters (key=value)")
  .option("-d, --data <json>", "JSON request body")
  .option("--method <method>", "HTTP method")
  .option("--raw", "Raw JSON output")
  .option("--stream", "Stream response")
  .action((slug: string, path: string, opts: Record<string, unknown>) =>
    wrap(runAction)(slug, path, {
      q: opts.query as string[] | undefined,
      d: opts.data as string | undefined,
      method: opts.method as string | undefined,
      raw: opts.raw as boolean | undefined,
      stream: opts.stream as boolean | undefined,
    })
  );

// ── Chat (LLM Gateway) ──

program
  .command("chat [message]")
  .description("Chat with AI models via the AISA gateway")
  .option("--model <model>", "Model ID (default: gpt-4.1)")
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

// ── Search shortcuts ──

program
  .command("web-search <query>")
  .description("Search the web")
  .option("--type <type>", "Search type: smart, full, youtube, scholar, tavily", "smart")
  .option("--limit <n>", "Max results")
  .option("--raw", "Raw JSON output")
  .action(wrap(webSearchAction));

program
  .command("scholar <query>")
  .description("Search academic papers")
  .option("--limit <n>", "Max results")
  .option("--raw", "Raw JSON output")
  .action(wrap(scholarAction));

// ── Finance shortcuts ──

program
  .command("stock <symbol>")
  .description("Look up stock data")
  .option("--field <field>", "Data field: price, earnings, financials, filings, insider, institutional, metrics, news", "price")
  .option("--raw", "Raw JSON output")
  .action(wrap(stockAction));

program
  .command("crypto <symbol>")
  .description("Look up crypto price")
  .option("--period <period>", "Time period: current, 1d, 7d, 30d, 1y")
  .option("--raw", "Raw JSON output")
  .action(wrap(cryptoAction));

program
  .command("screener")
  .description("Screen stocks by criteria")
  .option("--sector <sector>", "Filter by sector")
  .option("--limit <n>", "Max results")
  .option("--raw", "Raw JSON output")
  .action(wrap(screenerAction));

// ── Twitter shortcuts ──

program
  .command("tweet <text>")
  .description("Post a tweet")
  .option("--reply-to <id>", "Reply to tweet ID")
  .option("--raw", "Raw JSON output")
  .action(wrap(tweetAction));

const twitter = program.command("twitter").description("Twitter/X operations");

twitter
  .command("search <query>")
  .description("Search tweets")
  .option("--limit <n>", "Max results")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterSearchAction));

twitter
  .command("user <username>")
  .description("Get user profile")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUserAction));

twitter
  .command("trends")
  .description("Get trending topics")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterTrendsAction));

// ── Video shortcuts ──

const video = program.command("video").description("AI video generation");

video
  .command("create <prompt>")
  .description("Create a video generation task")
  .option("--model <model>", "Generation model")
  .option("--wait", "Wait for completion")
  .option("--output <path>", "Download output path")
  .option("--raw", "Raw JSON output")
  .action(wrap(videoCreateAction));

video
  .command("status <task-id>")
  .description("Check video task status")
  .option("--raw", "Raw JSON output")
  .action(wrap(videoStatusAction));

// ── Skills ──

const skills = program.command("skills").description("Browse and manage agent skills");

skills
  .command("list")
  .description("List available skills (WIP)")
  .option("--category <cat>", "Filter by category")
  .option("--limit <n>", "Max results")
  .action(wrap(skillsListAction));

skills
  .command("search <query>")
  .description("Search skills (WIP)")
  .option("--limit <n>", "Max results")
  .action(wrap(skillsSearchAction));

skills
  .command("show <slug>")
  .description("Show skill details (WIP)")
  .action(wrap(skillsShowAction));

skills
  .command("add <slug>")
  .description("Install a skill to agent directories (WIP)")
  .option("--agent <agent>", "Target agent: claude, cursor, copilot, windsurf, codex, gemini, openclaw, all")
  .action(wrap(skillsAddAction));

skills
  .command("remove <slug>")
  .description("Remove an installed skill (WIP)")
  .option("--agent <agent>", "Target agent")
  .action(skillsRemoveAction);

skills
  .command("update [slug]")
  .description("Update installed skill(s) (WIP)")
  .action(wrap(skillsUpdateAction));

skills
  .command("init <name>")
  .description("Initialize a new skill")
  .option("--template <template>", "Template: llm, search, finance, twitter, video")
  .option("--bare", "Minimal template")
  .action(skillsInitAction);

skills
  .command("submit <path>")
  .description("Submit a skill to AISA (WIP)")
  .action(wrap(skillsSubmitAction));

skills
  .command("push <slug>")
  .description("Push local changes to a submitted skill (WIP)")
  .action(wrap(skillsPushAction));

skills
  .command("request-verification <slug>")
  .description("Request skill verification (WIP)")
  .action(wrap(skillsVerifyAction));

// ── MCP ──

const mcp = program.command("mcp").description("MCP server integration");

mcp
  .command("setup")
  .description("Configure AISA MCP server for AI agents")
  .option("--agent <agent>", "Target agent: cursor, claude-desktop, windsurf, all")
  .action(mcpSetupAction);

mcp
  .command("status")
  .description("Check MCP server configuration status")
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

// ── Top-level aliases ──

program
  .command("search <query>")
  .description("Search APIs (alias for 'api search') (WIP)")
  .option("--limit <n>", "Max results")
  .action(wrap(apiSearchAction));

program
  .command("code <slug> <path>")
  .description("Generate code (alias for 'api code') (WIP)")
  .option("--lang <language>", "Language", "typescript")
  .action(wrap(apiCodeAction));

// ── Parse ──

program.parse();
