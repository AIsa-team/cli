# @aisa-one/cli

Command-line access to [AIsa](https://aisa.one): **one API key** for
**Claude, GPT, Gemini, DeepSeek, Kimi, GLM** and published Tool Router
operations. Browse the public provider/endpoint catalog separately;
catalog metadata is not a substitute for `schema` or `quote`.

## Install

```bash
npm install -g @aisa-one/cli
```

## Quick Start

```bash
# Sign in (browser; stores a CLI key — no key to copy)
aisa login

# Discover published tools (Router; search/schema may be anonymous)
aisa search "company facts" --json
aisa schema get_financial_company_facts --json

# Browse the read-only provider/endpoint catalog
aisa api list
aisa api show financial

# Chat with any model
aisa chat "Explain quantum computing" --model claude-opus-4-6

# Quote then execute a published Router tool (same request JSON)
aisa quote --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
```

`aisa login` opens a browser, signs you in, and stores a CLI key. You do not
need to create or paste a key from the console. For CI or scripts, set
`AISA_API_KEY` or run `aisa login --key <key>`. New accounts receive $5 in
free credits.

Root help lists 21 explicit commands plus implicit `help`. Removed domain
shortcuts and raw execution names are unknown commands — not aliases and
not forwarded to `aisa call`.

## Published tools (Tool Router)

These four commands are a thin HTTP client for the same Router service MCP
uses. They do not search the local catalog cache and do not call providers
directly.

| CLI | MCP identifier | POST path |
|---|---|---|
| `aisa search` | `AISA_SEARCH_TOOL` | `/v1/tool-router/aisa-search-tool` |
| `aisa schema` | `AISA_BATCH_GET_SCHEMA` | `/v1/tool-router/aisa-batch-get-schema` |
| `aisa quote` | `AISA_BATCH_QUOTE` | `/v1/tool-router/aisa-batch-quote` |
| `aisa call` | `AISA_BATCH_USE` | `/v1/tool-router/aisa-batch-use` |

`--json` prints the unmodified application body (MCP identifiers stay).
Human output maps only those four identifiers onto CLI names. `aisa manifest`
and `aisa manifest search` / `schema` / `quote` / `call` expose `mcp`, `auth`,
`enforced`, `safety`, `exits`, and parseable `examples`.

Recommended sequence: discover a tool → `aisa schema` when
`has_full_schema=false` → `aisa quote` → `aisa call`. Quote and call share
one request shape. **Enforced:** invalid local input exits 2 and is not sent;
quote and call refuse to run without a configured AIsa API key. **Not
enforced:** the CLI does not record quotes, approvals, or budget caps and
does not reject an unquoted call. **Instruction:** do not execute unquoted
calls; the caller must ensure a matching quote and approval. Quote is a
price observation, not authorization. A data request or credentials alone is
not spending approval. Do not invent tool names or guess required values.
`aisa call` is billable. A missing or failed quote is never free. Estimated
cost is not a limit. If a hard monetary cap is required, do not execute
calls with no guaranteed maximum. A partial quote is not a full-batch total;
call only an independently approved successful subset, and do not silently
retry. Without a configured AIsa API key, do not invent a business result.

`--input` is inline JSON (no file required). Documented shell examples use
POSIX single quotes so apostrophes, Unicode, `$()`, and backticks stay
literal.

`get_financial_company_facts` is a published tool whose schema includes
`ticker`. Do not invent unpublished tool names. Router search does not
guarantee every former domain-shortcut function.

```sh
aisa search "company facts" --json
aisa search --input '{"query":"company facts","limit":5}' --json
aisa search --input '{"query":"company facts","known_fields":{"name":"O'\''Reilly — 苹果"}}' --json
aisa search -f request.json --json
aisa search -f - --json < request.json
aisa schema get_financial_company_facts --json
aisa schema --input '{"tools":["get_financial_company_facts"]}' --json
aisa quote --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa quote -f request.json --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa call -f - --json < request.json
```

`--json` keeps large integer tokens. Diagnostics go to stderr. Exit `2` means
local input was invalid and nothing was sent; `1` is transport, auth, or an
HTTP error; `3` means the Router returned a batch with at least one failed
item.

`search` and `schema` may be anonymous. `quote` and `call` require a
configured AIsa API key. Sign in with `aisa login` first; it mints and stores
a CLI key. Resolution order is unchanged: `AISA_API_KEY`, then `~/.aisa/key`,
then legacy login. `AISA_API_KEY` still takes precedence over the stored key.
For CI, set `AISA_API_KEY` or use `aisa login --key <key>`. The default Router
origin is `https://tools.aisa.one` (independent of `baseUrl` /
`https://api.aisa.one`). Point a test Router at `AISA_ROUTER_BASE_URL` (origin
or prefix before `/v1/tool-router/...`), or `aisa config set routerUrl`. There
is no origin fallback.

`quote` never executes. Router requests do not follow HTTP redirects, so a
307/308 cannot turn quote into call. There is no automatic quote-to-call sequence and no
retry.

## API Catalog

`api list` and `api show` are the supported read-only catalog. They browse
public provider and endpoint metadata (`--json`, `--refresh`, `--health`,
`--category`, path filters). They are not deprecated and are not Router
`search` / `schema`. Catalog paths and prices are browsing metadata, not a
substitute for schema or quote, and not a way to execute an endpoint.

```bash
aisa api list                          # all catalog providers
aisa api list --category finance       # finance, search, social, productivity, other
aisa api list --health                 # include provider health

aisa api show financial                # endpoints in one provider
aisa api show financial /news          # one endpoint: params and catalog price
aisa api show dataforseo --all         # long lists truncate to 40 by default
```

A provider **id is not always its URL slug** — `brave-search` serves
`/apis/v1/brave/...`, and `api show` prints the catalog path. The catalog
reports every method as `GET`; treat that as advisory.

The catalog is cached in `~/.aisa/cache` (override with `AISA_CACHE_DIR`). Pass
`--refresh` to any command to bypass it, or `aisa cache clear`.

## LLM Gateway

GPT, Claude, Gemini, DeepSeek, Kimi, GLM, Qwen and the rest behind one
OpenAI-compatible endpoint.

```bash
aisa chat "your message" --model gpt-4.1-mini
aisa chat "explain this" --model claude-opus-4-6
aisa chat "respond in JSON" --model gemini-2.5-pro --json
echo "summarize this" | aisa chat                  # pipe support

aisa models                          # list all models
aisa models --provider anthropic     # filter by provider
aisa models show gpt-4.1-mini        # model details
```

Streaming is on by default; pass `--no-stream` to disable it.

## Account

```bash
aisa balance                        # wallet and API key credit balance
aisa balance --json
aisa topup                          # open the console billing page to add credit
aisa topup 20                       # same, deep-linked to $20
```

Payment always finishes in the browser: card details belong to Stripe's hosted
page, not to us, and a bank's 3-D Secure step needs one. `topup` opens the
right page; `--no-open` prints the URL instead.

`aisa usage` is not available yet — the gateway does not serve
`GET /v1/credits/usage` (it 404s, while `/v1/credits/balance` on the same route
group works). Use the [console](https://console.aisa.one/logs) for usage history
in the meantime.

## Skills

Skills are markdown files that teach AI coding agents (Claude Code, Cursor,
Copilot, …) how to use AIsa. They come from the
[agent-skills](https://github.com/AIsa-team/agent-skills) repository.

```bash
aisa skills list                              # all skills
aisa skills list --category financial         # one category
aisa skills search "financial analysis"
aisa skills show marketpulse                  # bare name or financial/marketpulse
aisa skills install marketpulse               # install to detected agent directories
aisa skills install marketpulse --force       # replace whatever occupies that directory
aisa skills remove marketpulse
```

Installing replaces the target directory rather than merging into it, so a
previous skill's scripts and assets cannot linger and keep being loaded, and a
partial download aborts without touching what is already there. Each install
writes a small `.aisa-skill.json` recording which skill owns the directory —
that marker is what lets the CLI tell two same-named skills apart.

Naming a category (`financial/marketpulse`) means "this specific skill", so the
CLI checks the marker before replacing or removing anything. A directory
installed before markers existed cannot be verified that way, so those need
`--force`. A bare name (`marketpulse`) means "whatever holds that directory" and
always works — it only resolves when the leaf name is unique across the repo.

Skills install to whichever agent directories exist on your machine:

| Agent | Directory |
|-------|-----------|
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| GitHub Copilot | `~/.github/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` |
| Codex | `~/.agents/skills/` |
| Gemini | `~/.gemini/skills/` |
| OpenClaw | `~/.openclaw/skills/` |

### Create Skills

```bash
aisa skills init my-skill                          # default template
aisa skills init my-skill --template finance       # finance, llm, search, twitter, video
```

Bundled templates may keep those domain labels. Their runnable steps use
`search` / `schema` / `quote` / `call` (and optional `api list` / `api show`).
They do not invent tool names or treat Router as a replacement for every
removed shortcut. The `llm` template stays on `chat` / `models`.

To publish a skill, open a pull request against
[AIsa-team/agent-skills](https://github.com/AIsa-team/agent-skills).

## MCP Server

### One-liner: `connect`

```bash
npx @aisa-one/cli connect
```

Opens a small local page (served by this process on `127.0.0.1`, shut down
when finished) where you tick the AIsa MCP servers you want and the coding
agents to install them into. Claude Code is configured through its own
`claude mcp add` (user scope), then signed in through its own OAuth: connect
runs `claude mcp login` per server, your browser opens the AIsa
authorization, and the tokens live in Claude Code's own store where it also
refreshes them — no API key, nothing pasted. Cursor, Claude Desktop and
Windsurf get config entries and run the same OAuth themselves on first use.
The page matches the AIsa Console style, reports authorization progress
live, and a success page with copy-paste try-it-now prompts opens when
everything is connected. No daemon stays behind. `--no-open` prints the URL
instead of launching a browser; `--dry-run` shows what would be written.

### Scripted: `mcp setup`

```bash
aisa mcp setup                          # configure the default servers for every detected client
aisa mcp setup --all                    # every live server, not just the defaults
aisa mcp setup --agent cursor           # one client only
aisa mcp status                         # list entries and ping each configured endpoint
```

`setup` reads the platform's discovery manifest (`aisa.one/.well-known/mcp.json`)
at run time and writes one entry per live server, in the shape each client
executes: a `url` entry for Cursor, an `npx mcp-remote` stdio bridge for
Claude Desktop and Windsurf. With an API key configured the entries carry it
as a Bearer header; without one they carry no credentials and the server's
OAuth flow opens in your browser on first use. A config file that exists but
does not parse is never overwritten. The docs-search MCP is always included
as `aisa-docs`.

## Shell Completion

```bash
# zsh
aisa completion zsh > "${fpath[1]}/_aisa"      # then restart your shell
# or, without touching fpath:
echo 'eval "$(aisa completion zsh)"' >> ~/.zshrc

# bash
aisa completion bash > /usr/local/etc/bash_completion.d/aisa
# or:
echo 'eval "$(aisa completion bash)"' >> ~/.bashrc

# fish
aisa completion fish > ~/.config/fish/completions/aisa.fish
```

`aisa completion` with no argument detects your shell from `$SHELL`.

Completion covers commands, subcommands, and options, plus values pulled from
the local cache:

```
aisa api show <TAB>            → provider ids
aisa api list --category <TAB> → finance, search, social, productivity, other
aisa skills show <TAB>         → skill names
aisa chat --model <TAB>        → model ids
```

The cache-backed suggestions only appear once the relevant command has been run
at least once — completion never makes a network request, so a cold cache
completes commands and flags but no dynamic values. Run `aisa api list`,
`aisa models`, and `aisa skills list` once to warm everything up.

## Configuration

```bash
aisa config set defaultModel claude-opus-4-6
aisa config get defaultModel
aisa config list                                # also shows derived base URLs
aisa config reset
```

Settings:
- `defaultModel` — default model for `aisa chat` (default: `gpt-4.1-mini`)
- `baseUrl` — platform root; the LLM (`/v1`), integration (`/apis/v1`), and
  catalog bases are all derived from it
- `routerUrl` — Tool Router origin (default `https://tools.aisa.one`,
  independent of `baseUrl`); overridden by `AISA_ROUTER_BASE_URL`
- `outputFormat` — `text` or `json`

`aisa login` stores a CLI key in `~/.aisa/key`. Environment variables:
`AISA_API_KEY` takes precedence over the stored key.
`AISA_ROUTER_BASE_URL` is the Router origin/prefix before
`/v1/tool-router/...` and overrides the default `https://tools.aisa.one`.
`AISA_CACHE_DIR` relocates the cache. `GITHUB_TOKEN`
raises the GitHub rate limit for skills commands.

## Development

```bash
git clone https://github.com/AIsa-team/cli.git
cd cli
npm install
npm run build       # compile TypeScript
npm run dev         # watch mode
npm test            # run tests
npm run package:smoke  # clean pack, isolated install, installed-bin checks
```

Release metadata and the exact merge/tag publish path (not an authorization
to publish) are in [`docs/release.md`](docs/release.md).

## Appendix: Notes for Contributors

**Three bases, one root.** `resolveBases()` in `src/api.ts` derives the LLM base
(`/v1`), the integration base (`/apis/v1`), and the catalog root from a single
configured `baseUrl`. It tolerates a value with either suffix already attached,
because the shipped default has always included `/v1` and is persisted in every
existing user's config.

**The catalog's shape has three traps.** `endpoints[].method` is hardcoded to
`GET` server-side. `endpoint_groups[].name` is an operator-entered label
(`Zero`, `One`, `default`) with no business meaning, which is why `api show`
flattens by default. And health is tracked per provider, not per endpoint, so
per-endpoint counts are one value repeated.

**Parameter naming varies by endpoint.** Scholar uses `query`, finance uses
`ticker` (not `symbol`), Twitter uses `userName`. `aisa api show <api> <path>`
prints each endpoint's description and path parameters. That listing is
catalog metadata, not an execution recipe.

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 AIsa Team.
