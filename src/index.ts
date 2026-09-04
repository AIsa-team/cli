#!/usr/bin/env node

import { Command, Option } from "commander";
import { VERSION, DEFAULT_VIDEO_MODEL } from "./constants.js";

// Auth
import { loginAction, logoutAction, whoamiAction } from "./commands/auth.js";
// Account
import { balanceAction, topupAction, usageAction } from "./commands/account.js";
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
import {
  tweetAction, twitterSearchAction, twitterUserAction, twitterTrendsAction,
  twitterUserAboutAction, twitterBatchUsersAction, twitterUserTweetsAction,
  twitterMentionsAction, twitterFollowersAction, twitterFollowingAction,
  twitterVerifiedFollowersAction, twitterCheckFollowAction, twitterUserSearchAction,
  twitterDetailAction, twitterRepliesAction, twitterQuotesAction,
  twitterRetweetersAction, twitterThreadAction, twitterArticleAction,
  twitterListMembersAction, twitterListFollowersAction,
  twitterCommunityInfoAction, twitterCommunityMembersAction,
  twitterCommunityModsAction, twitterCommunityTweetsAction, twitterCommunitySearchAction,
  twitterSpaceAction,
  twitterLoginAction, twitterLogoutAction,
  twitterLikeAction, twitterUnlikeAction, twitterRetweetAction,
  twitterDeleteAction, twitterFollowAction, twitterUnfollowAction,
  twitterUploadMediaAction, twitterDmAction,
} from "./commands/twitter.js";
// Video
import { videoCreateAction, videoStatusAction } from "./commands/video.js";
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
// Config
import { configSetAction, configGetAction, configListAction, configResetAction } from "./commands/configCmd.js";
// Cache
import { cacheClearAction, cachePathAction } from "./commands/cacheCmd.js";
// Completion
import { completionAction, completeAction } from "./commands/completionCmd.js";
// Manifest
import { manifestAction } from "./commands/manifest.js";
import { serveResultsAction } from "./commands/serve-results.js";

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
  .description("AIsa CLI - Unified AI infrastructure platform")
  .version(VERSION);

// ── Auth ──

program
  .command("login")
  .description("Sign in to AIsa — browser sign-in by default, or --key to paste one")
  .option("--key <key>", "API key (skips the browser sign-in)")
  .option("--no-browser", "Print the sign-in URL and paste the redirect back (detected on its own over SSH)")
  .action(wrap(loginAction));

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

// ── API ──

const api = program.command("api").description("Discover and inspect APIs");

api
  .command("list")
  .description("List available APIs")
  .option("--category <cat>", "Filter by category (client-side grouping): finance, search, social, productivity, other")
  .option("--health", "Include provider health status")
  .option("--json", "Output raw JSON")
  .option("--refresh", "Bypass the cached catalog")
  .action(wrap(apiListAction));

api
  .command("search <query>")
  .description("Search APIs and endpoints by keyword")
  .option("--provider <id>", "Restrict to one API")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output raw JSON")
  .option("--refresh", "Bypass the cached catalog")
  .action(wrap(apiSearchAction));

api
  .command("show <api> [path]")
  .description("Show an API's endpoints, or one endpoint's details")
  .option("--all", "Show every endpoint instead of the first 40")
  .option("--group", "Group by the provider's raw endpoint groups")
  .option("--health", "Include provider health status")
  .option("--json", "Output raw JSON")
  .option("--refresh", "Bypass the cached catalog")
  .action(wrap(apiShowAction));

api
  .command("code <slug> <path>")
  .description("Generate a request snippet for an endpoint")
  .option("--lang <language>", "Language: curl, python, node, typescript", "curl")
  .option("--method <method>", "HTTP method (the catalog's method is advisory)", "GET")
  .option("--refresh", "Bypass the cached catalog")
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
  .option("--domain", "Force the integration API base (/apis/v1) — the default")
  .option("--llm", "Force the LLM gateway base (/v1)")
  .option("--show-cost", "Print the billing headers the gateway reported (stderr)")
  .action((slug: string, path: string, opts: Record<string, unknown>) =>
    wrap(runAction)(slug, path, {
      q: opts.query as string[] | undefined,
      d: opts.data as string | undefined,
      method: opts.method as string | undefined,
      raw: opts.raw as boolean | undefined,
      stream: opts.stream as boolean | undefined,
      llm: opts.llm as boolean | undefined,
      domain: opts.domain as boolean | undefined,
      showCost: opts.showCost as boolean | undefined,
    })
  );

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

// ── Search shortcuts ──

program
  .command("web-search <query>")
  .description("Search the web")
  .option(
    "--type <type>",
    "Search type: tavily, youtube, scholar, smart (degraded), full (degraded)",
    "tavily"
  )
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
  .option("--field <field>", "Data field: info, estimates, financials, filings, insider, institutional, news")
  .option("--raw", "Raw JSON output")
  .action(wrap(stockAction));

program
  .command("crypto <symbol>")
  .description("Look up crypto price")
  .option("--period <period>", "Time period: current, 1d, 7d, 30d, 90d, 1y")
  .option("--id <coingecko-id>", "Use an exact CoinGecko id instead of resolving the symbol")
  .option("--source <source>", "Data source: coingecko (default) or financial")
  .option("--raw", "Raw JSON output")
  .action(wrap(cryptoAction));

program
  .command("screener")
  .description("Screen stocks by criteria")
  .option("--sector <sector>", "Filter by GICS sector (e.g. 'Information Technology')")
  .option("--min-market-cap <n>", "Minimum market cap in USD")
  .option("--filter <f...>", "Extra filter as field:operator:value (e.g. market_cap:gt:1e12)")
  .option("--limit <n>", "Max results")
  .option("--raw", "Raw JSON output")
  .action(wrap(screenerAction));

// ── Twitter shortcuts ──

program
  .command("tweet <text>")
  .description("Post a tweet (requires twitter login)")
  .option("--reply-to <id>", "Reply to tweet ID")
  .option("--media-ids <ids>", "Comma-separated media IDs")
  .option("--raw", "Raw JSON output")
  .action(wrap(tweetAction));

const twitter = program.command("twitter").description("Twitter/X operations");

// Auth
twitter
  .command("login")
  .description("Login to Twitter or import cookies")
  .option("--username <name>", "Twitter username")
  .option("--email <email>", "Account email")
  .option("--password <pass>", "Account password")
  .option("--proxy <url>", "Proxy URL (required)")
  .option("--totp <secret>", "2FA TOTP secret")
  .option("--cookies <cookies>", "Import login_cookies directly")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterLoginAction));

twitter
  .command("logout")
  .description("Clear stored Twitter cookies")
  .action(twitterLogoutAction);

// User read
twitter
  .command("user <username>")
  .description("Get user profile")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUserAction));

twitter
  .command("user-about <username>")
  .description("Get user profile details (country, verification, name history)")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUserAboutAction));

twitter
  .command("batch-users <ids>")
  .description("Get multiple users by comma-separated IDs")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterBatchUsersAction));

twitter
  .command("user-tweets <username>")
  .description("Get user's recent tweets")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUserTweetsAction));

twitter
  .command("mentions <username>")
  .description("Get user mentions")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterMentionsAction));

twitter
  .command("followers <username>")
  .description("Get user followers")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterFollowersAction));

twitter
  .command("following <username>")
  .description("Get user followings")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterFollowingAction));

twitter
  .command("verified-followers <user-id>")
  .description("Get verified followers (requires user ID)")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterVerifiedFollowersAction));

twitter
  .command("check-follow <source> <target>")
  .description("Check follow relationship between two usernames")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterCheckFollowAction));

twitter
  .command("user-search <query>")
  .description("Search users by keyword")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUserSearchAction));

// Tweet read
twitter
  .command("search <query>")
  .description("Search tweets")
  .option("--type <type>", "Query type: latest or top", "latest")
  .option("--limit <n>", "Max results")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterSearchAction));

twitter
  .command("detail <ids>")
  .description("Get tweets by comma-separated IDs")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterDetailAction));

twitter
  .command("replies <tweet-id>")
  .description("Get tweet replies")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterRepliesAction));

twitter
  .command("quotes <tweet-id>")
  .description("Get tweet quotes")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterQuotesAction));

twitter
  .command("retweeters <tweet-id>")
  .description("Get tweet retweeters")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterRetweetersAction));

twitter
  .command("thread <tweet-id>")
  .description("Get full conversation thread")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterThreadAction));

twitter
  .command("article <tweet-id>")
  .description("Get article content by tweet ID")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterArticleAction));

// Trends
twitter
  .command("trends")
  .description("Get trending topics")
  .option("--woeid <id>", "Location WOEID (1 = worldwide)", "1")
  .option("--count <n>", "Number of trends")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterTrendsAction));

// Lists
twitter
  .command("list-members <list-id>")
  .description("Get list members")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterListMembersAction));

twitter
  .command("list-followers <list-id>")
  .description("Get list followers")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterListFollowersAction));

// Communities
twitter
  .command("community-info <community-id>")
  .description("Get community info")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterCommunityInfoAction));

twitter
  .command("community-members <community-id>")
  .description("Get community members")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterCommunityMembersAction));

twitter
  .command("community-mods <community-id>")
  .description("Get community moderators")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterCommunityModsAction));

twitter
  .command("community-tweets <community-id>")
  .description("Get community tweets")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterCommunityTweetsAction));

twitter
  .command("community-search <query>")
  .description("Search tweets across all communities")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterCommunitySearchAction));

// Spaces
twitter
  .command("space <space-id>")
  .description("Get Space details")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterSpaceAction));

// Write operations
twitter
  .command("like <tweet-id>")
  .description("Like a tweet")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterLikeAction));

twitter
  .command("unlike <tweet-id>")
  .description("Unlike a tweet")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUnlikeAction));

twitter
  .command("retweet <tweet-id>")
  .description("Retweet a tweet")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterRetweetAction));

twitter
  .command("delete <tweet-id>")
  .description("Delete a tweet")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterDeleteAction));

twitter
  .command("follow <user-id>")
  .description("Follow a user (requires user ID)")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterFollowAction));

twitter
  .command("unfollow <user-id>")
  .description("Unfollow a user (requires user ID)")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUnfollowAction));

twitter
  .command("upload-media <file-path>")
  .description("Upload media file for tweets")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterUploadMediaAction));

twitter
  .command("dm <user-id> <text>")
  .description("Send a direct message")
  .option("--raw", "Raw JSON output")
  .action(wrap(twitterDmAction));

// ── Video shortcuts ──

const video = program.command("video").description("AI video generation");

video
  .command("create <prompt>")
  .description("Create a video generation task")
  .option("--model <model>", `Generation model (default: ${DEFAULT_VIDEO_MODEL})`)
  .option("--image <url...>", "Source image for i2v models (shorthand for --media first_frame=<url>)")
  .option("--media <type=url...>", "Source media: first_frame, last_frame, driving_audio, first_clip")
  .option("--resolution <res>", "Resolution, e.g. 720P or 1080P", "720P")
  .option("--duration <seconds>", "Clip duration in seconds", "5")
  .option("--body <json>", "Send this request body verbatim (escape hatch for unmodelled vendors)")
  .option("--wait", "Wait for completion")
  .option("--output <path>", "Download the finished video to this path (implies --wait)")
  .option("--raw", "Raw JSON output")
  .action((prompt: string, opts: Record<string, unknown>) =>
    wrap(videoCreateAction)(prompt, { ...opts, wait: Boolean(opts.wait || opts.output) })
  );

video
  .command("status <task-id>")
  .description("Check video task status")
  .option("--output <path>", "Download the finished video to this path")
  .option("--raw", "Raw JSON output")
  .action(wrap(videoStatusAction));

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

// ── Top-level aliases ──

program
  .command("search <query>")
  .description("Search APIs (alias for 'api search')")
  .option("--provider <id>", "Restrict to one API")
  .option("--limit <n>", "Max results", "20")
  .option("--json", "Output raw JSON")
  .option("--refresh", "Bypass the cached catalog")
  .action(wrap(apiSearchAction));

program
  .command("code <slug> <path>")
  .description("Generate a request snippet (alias for 'api code')")
  .option("--lang <language>", "Language: curl, python, node, typescript", "curl")
  .option("--method <method>", "HTTP method")
  .action(wrap(apiCodeAction));

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
// The root page also gets worked examples: the fastest way to convey that
// `run` takes repeated -q pairs is to show one.
program.addHelpText(
  "after",
  `
Examples:
  $ aisa connect                      wire your coding agent to AIsa (start here)
  $ aisa twitter search "ai" --raw    search X, full JSON out
  $ aisa api show coingecko           list one API's endpoints
  $ aisa run coingecko simple/price -q ids=bitcoin -q vs_currencies=usd`
);

// Last, after the human-facing examples: it is the line an agent scanning to
// the end of the page will find.
applyHelpStyle(program);

// ── Parse ──

program.parse();
