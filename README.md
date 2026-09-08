# @aisa-one/cli

Command-line access to [AIsa](https://aisa.one): **one API key** for
**Claude, GPT, Gemini, DeepSeek, Kimi, GLM** and the live data behind them —
finance, web search, social, research, and video generation.

## Install

```bash
npm install -g @aisa-one/cli
```

## Quick Start

```bash
# Authenticate (or set AISA_API_KEY)
aisa login --key sk-your-api-key

# Discover published tools (Router; search/schema may be anonymous)
aisa search "company facts" --json
aisa schema get_financial_company_facts --json

# Old catalog keyword search is still available (deprecated; not a drop-in)
aisa api list
aisa api search "insider trades"

# Chat with any model
aisa chat "Explain quantum computing" --model claude-opus-4-6

# Look up a stock
aisa stock AAPL

# Search the web
aisa web-search "latest AI research"

# Quote then execute a published Router tool (same request JSON; shared AISA_API_KEY)
aisa quote --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json

# Raw provider/LLM routing is still available (deprecated; not a drop-in for aisa call)
aisa run financial /insider-trades -q "ticker=AAPL"
```

Get your API key at
[console.aisa.one/api-keys](https://console.aisa.one/api-keys). New accounts
receive $5 in free credits.

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
`safety`, `exits`, and parseable `examples` (the root node also has `router`).

Flow: discover a tool → `aisa schema` when `has_full_schema=false` → `aisa quote`
→ authorized `aisa call`. Quote and call share one request shape. Quote is a
price observation, not authorization. A data request or credentials alone is
not spending approval. Do not invent tool names or guess required values.
`aisa call` is billable and needs a matching quote plus explicit approval
covering that cost and any uncertainty. A missing or failed quote is never
free. Estimated cost is not a limit. If a hard monetary cap is required, do
not execute calls with no guaranteed maximum. A partial quote is not a
full-batch total; call only an independently approved successful subset, and
do not silently retry. Without `AISA_API_KEY`, search and schema may be
anonymous; quote and call will not run — do not invent a business result.

`--input` is inline JSON (no file required). Apostrophes and Unicode are part
of the JSON text; quote the argument so the shell preserves them.

`get_financial_company_facts` is a published tool whose schema includes
`ticker`. Do not invent unpublished tool names.

```bash
aisa search "company facts" --json
aisa search --input '{"query":"company facts","limit":5}' --json
aisa search --input "{\"query\":\"company facts\",\"known_fields\":{\"name\":\"O'Reilly — 苹果\"}}" --json
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

`search` and `schema` may be anonymous. `quote` and `call` require
`AISA_API_KEY` (the same key as `aisa login` / `aisa run`). The default Router
origin is `https://tools.aisa.one` (independent of `baseUrl` /
`https://api.aisa.one`). Point a test Router at `AISA_ROUTER_BASE_URL` (origin
or prefix before `/v1/tool-router/...`), or `aisa config set routerUrl`. There
is no origin fallback.

`quote` never executes. Router requests do not follow HTTP redirects, so a
307/308 cannot turn quote into call. There is no automatic quote-to-call sequence and no
retry.

## API Catalog

The catalog still lists integration providers. `api list` and `api code` are
unchanged. `api search` and `api show` keep their previous catalog behavior
and are deprecated; they are not drop-in replacements for `search` / `schema`
(catalog keyword/id browse vs Router published tools).

```bash
aisa api list                          # all 29 providers
aisa api list --category finance       # finance, search, social, productivity, other
aisa api list --health                 # include provider health

aisa api show financial                # every endpoint in one provider
aisa api show financial /news          # one endpoint: params, price, run command
aisa api show dataforseo --all         # 453 endpoints (truncated to 40 by default)

aisa api search "stock screener"       # search across every endpoint
aisa api search rank --provider dataforseo

aisa api code financial /news --lang curl     # curl, python, node, typescript
```

Two things worth knowing: a provider's **id is not always its URL slug** —
`brave-search` serves `/apis/v1/brave/...`, and `api show` prints the path you
actually call. And the catalog reports every method as `GET`; pass `--method` to
`api code` when an endpoint takes a POST.

The catalog is cached in `~/.aisa/cache` (override with `AISA_CACHE_DIR`). Pass
`--refresh` to any command to bypass it, or `aisa cache clear`.

## Execute Any Endpoint

`aisa run` still sends raw provider and LLM requests. It is not a drop-in for
`aisa call` (`AISA_BATCH_USE`). `run` is deprecated but unchanged. Specialized
commands (`stock`, `web-search`, `twitter`, …) are unaffected.

```bash
aisa run financial /insider-trades -q "ticker=AAPL"
aisa run coingecko /simple/price -q "ids=bitcoin&vs_currencies=usd"
aisa run brave /web/search -q "q=AI agents"
aisa run tavily /search -d '{"query": "AI news"}'
aisa run twitter /tweet/advanced_search -q "query=AI agents" --raw
aisa run dataforseo /serp/google/organic/live -d '{...}' --show-cost
```

`run` sends anything that isn't a known LLM gateway route to the integration
APIs, so providers added to the platform work without a CLI upgrade. Use
`--llm` or `--domain` to force a base.

`--show-cost` prints the gateway's billing headers on stderr, so it stays out of
the way of `--raw | jq`. Metered providers (DataForSEO, Jina) report the amount
actually charged and the credits consumed — for those the catalog's flat
per-request price is not what you pay. Other routes report only a price key, and
the LLM gateway reports nothing; the output says so rather than implying a call
was free.

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

## Finance

```bash
aisa stock AAPL                     # summary: company info + estimates + news
aisa stock AAPL --field insider     # insider trades
aisa stock AAPL --field news        # company news
aisa stock TSLA --field filings     # SEC filings
aisa stock MSFT --field estimates   # analyst EPS & revenue estimates
aisa stock AAPL --field financials  # balance sheets, income statements

aisa crypto BTC                     # price, 24h change, market cap
aisa crypto ETH --period 30d        # historical
aisa crypto --id render-token RNDR  # exact CoinGecko id when a symbol is ambiguous

aisa screener --sector "Information Technology"
aisa screener --min-market-cap 1000000000000 --limit 10
aisa screener --filter market_cap:gt:1e12 --filter sector:eq:Financials
```

Sectors use GICS names; short forms like `Technology` are mapped automatically.

## Web Search

```bash
aisa web-search "query"                     # Tavily (default)
aisa web-search "query" --type youtube      # YouTube search
aisa scholar "transformer architecture"     # academic papers
```

`--type smart` and `--type full` are currently degraded upstream and return 404
regardless of parameters. Use `tavily` until that is resolved.

## Twitter/X

```bash
aisa twitter user elonmusk                  # user profile
aisa twitter search "AI agents" --limit 20  # search tweets
aisa twitter trends                         # trending topics
aisa twitter user-tweets elonmusk           # recent tweets
aisa twitter thread <tweet-id>              # full conversation
```

Read operations work with just your API key. **Write operations** (`aisa tweet`,
`like`, `retweet`, `follow`, `dm`) additionally require Twitter login cookies
and a proxy — run `aisa twitter login --username <u> --password <p> --proxy <url>`
first. Run `aisa twitter --help` for the full list of 30+ subcommands.

## Video Generation

```bash
aisa video create "A sunset timelapse"                  # returns a task id
aisa video create "Dancing robot" --wait                # poll until done
aisa video create "A cat" --output cat.mp4              # wait and download
aisa video status <task-id>

# image-to-video: --image is shorthand for --media first_frame=<url>
aisa video create "the bird turns its head" --model wan2.7-i2v --image https://…/photo.jpg
aisa video create "extend this clip" --model wan2.7-r2v --media first_clip=https://…/in.mp4

# Seedance uses a different request shape; the CLI handles it
aisa video create "a cat walking" --model dreamina-seedance-2-0-fast-260128
```

| Model | Needs | Billing |
|-------|-------|---------|
| `wan2.7-t2v` (default), `happyhorse-1.1-t2v` | prompt only | per second |
| `wan2.7-i2v`, `happyhorse-1.1-i2v` | `--image` / `--media first_frame=` | per second |
| `wan2.7-r2v`, `happyhorse-1.1-r2v` | `--media first_clip=` | per second |
| `dreamina-seedance-2-0-260128`, `…-fast-260128` | prompt only | per token |

Media types: `first_frame`, `last_frame`, `driving_audio`, `first_clip`.

The gateway forwards the request body to whichever vendor owns the model, so the
shape differs per family — the CLI builds it for you and refuses up front if a
model needs source media you did not supply (the upstream would otherwise accept
the job, bill it, and fail a minute later). For a vendor or parameter the CLI
does not model, `--body '<json>'` is sent verbatim.

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
Copilot, …) how to use AIsa APIs. They come from the
[agent-skills](https://github.com/AIsa-team/agent-skills) repository — 42 skills
across six categories.

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
aisa run <TAB>                 → 29 provider slugs
aisa run financial <TAB>       → that provider's endpoints
aisa api show <TAB>            → provider ids
aisa skills show <TAB>         → 42 skill names
aisa chat --model <TAB>        → model ids
aisa web-search --type <TAB>   → tavily, youtube, scholar, …
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

Environment variables: `AISA_API_KEY` takes precedence over the stored key.
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

**Routing in `run`.** `resolveRunTarget()` (`src/commands/run.ts`) treats the LLM
gateway routes as the whitelist and everything else as an integration API. That
direction matters: gateway routes are hardcoded server-side and change roughly
annually, while provider slugs are database rows that operations edit
continuously.

**The catalog's shape has three traps.** `endpoints[].method` is hardcoded to
`GET` server-side. `endpoint_groups[].name` is an operator-entered label
(`Zero`, `One`, `default`) with no business meaning, which is why `api show`
flattens by default. And health is tracked per provider, not per endpoint, so
per-endpoint counts are one value repeated.

**Parameter naming varies by endpoint.** Scholar uses `query`, finance uses
`ticker` (not `symbol`), Twitter uses `userName`. `aisa api show <api> <path>`
prints each endpoint's description and path parameters.

**Video generation is async.** `POST /v1/video/generations` returns `202` with a
gateway-local `video_task_<hex>` id. Poll `GET /v1/video/generations/:id` until
`status` is one of `completed`, `failed`, or `cancelled`. The finished URL sits
at a different place in `result` for each vendor, so `findVideoUrl()` searches
for it.

**Twitter write operations require login cookies.** `create_tweet_v2` and the
other action endpoints need `login_cookies` and `proxy` in the body — the
gateway does not hold your Twitter session.

**Some financial endpoints return empty data.** `financial/prices` and
`financial/financial-metrics/snapshot` return `{}` for all tickers. `aisa stock`
uses `company/facts` + `analyst-estimates` + `news` instead. Working fields:
`info`, `estimates`, `financials`, `filings`, `insider`, `institutional`, `news`.

## License

MIT. See [LICENSE](LICENSE). Copyright (c) 2026 AIsa Team.
