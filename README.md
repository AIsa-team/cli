# @aisa-one/cli

CLI for the [AISA](https://aisa.one) unified AI infrastructure platform. Access 70+ LLMs, web search, financial data, Twitter/X, and video generation APIs — all from one command line.

## Install

```bash
npm install -g @aisa-one/cli
```

## Quick Start

```bash
# Authenticate
aisa login --key sk-your-api-key

# Chat with any LLM
aisa chat "Explain quantum computing" --model claude-opus-4-6

# Search the web
aisa web-search "latest AI research"

# Look up stock data
aisa stock AAPL

# Post a tweet
aisa tweet "Hello from AISA CLI!"

# Generate a video
aisa video create "A cat playing piano" --wait
```

Get your API key at [aisa.one/dashboard](https://aisa.one/dashboard). New accounts receive $5 in free credits.

## Commands

### Authentication

```bash
aisa login --key <key>    # Store API key (also reads AISA_API_KEY env var)
aisa logout               # Remove stored key
aisa whoami               # Show auth status
```

### LLM Gateway

Chat with 70+ models (GPT, Claude, Gemini, Qwen, Deepseek, Grok) through a single OpenAI-compatible endpoint.

```bash
aisa chat "your message" --model gpt-4.1
aisa chat "explain this" --model claude-opus-4-6 --stream
aisa chat "respond in JSON" --model gemini-2.5-pro --json
echo "summarize this" | aisa chat                        # pipe support

aisa models                          # list all models
aisa models --provider anthropic     # filter by provider
aisa models show gpt-4.1             # model details + pricing
```

### API Discovery & Execution

```bash
aisa api list                                # 🚧 WIP — not yet available
aisa api search "email finder"               # 🚧 WIP
aisa api show finance /stock/price           # 🚧 WIP
aisa api code finance /stock/price --lang python  # 🚧 WIP

# Execute any API (works now)
aisa run financial /insider-trades -q "ticker=AAPL"
aisa run tavily /search -d '{"query": "AI news"}'
aisa run twitter /tweet/advanced_search -q "query=AI agents" --raw
```

### Web Search

```bash
aisa web-search "query"                     # smart search (default)
aisa web-search "query" --type full         # full-text search
aisa web-search "query" --type youtube      # YouTube search
aisa web-search "query" --type tavily       # Tavily deep search
aisa scholar "transformer architecture"     # academic papers
```

### Finance

```bash
aisa stock AAPL                     # summary: company info + estimates + news
aisa stock AAPL --field insider     # insider trades
aisa stock AAPL --field news        # company news
aisa stock TSLA --field filings     # SEC filings
aisa stock MSFT --field estimates   # analyst EPS & revenue estimates
aisa stock AAPL --field financials  # balance sheets, income statements
aisa crypto BTC                     # crypto price snapshot
aisa crypto ETH --period 30d       # historical
aisa screener --sector Technology   # stock screener
```

### Twitter/X

```bash
aisa twitter user elonmusk                  # user profile
aisa twitter search "AI agents" --limit 20  # search tweets
aisa twitter trends                         # trending topics
aisa tweet "Hello world!"                   # post (⚠️ requires login cookies, see docs)
```

### Video Generation

```bash
aisa video create "A sunset timelapse"           # create task
aisa video create "Dancing robot" --wait         # wait for result
aisa video status <task-id>                      # check status
```

### Account

```bash
aisa balance                # 🚧 WIP — check https://aisa.one/dashboard
aisa usage --limit 20       # 🚧 WIP
```

## Skills

Skills are markdown files that teach AI coding agents (Claude Code, Cursor, Copilot, etc.) how to use AISA APIs.

### Browse & Install

```bash
aisa skills list                              # 🚧 WIP — requires backend
aisa skills search "financial analysis"       # 🚧 WIP
aisa skills show aisa-team/finance-analyst    # 🚧 WIP
aisa skills add aisa-team/finance-analyst     # 🚧 WIP
aisa skills remove aisa-team/finance-analyst  # 🚧 WIP
```

Skills install to agent directories automatically:

| Agent | Directory |
|-------|-----------|
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| GitHub Copilot | `~/.github/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` |
| Codex | `~/.agents/skills/` |
| Gemini | `~/.gemini/skills/` |
| OpenClaw | `~/.openclaw/skills/` |

### Create & Publish

```bash
aisa skills init my-skill                          # create from default template (works locally)
aisa skills init my-skill --template finance       # finance template
aisa skills init my-skill --template llm           # LLM template
aisa skills submit ./my-skill                      # 🚧 WIP — requires backend
aisa skills push owner/my-skill                    # 🚧 WIP
aisa skills request-verification owner/my-skill    # 🚧 WIP
```

Available templates: `default`, `llm`, `search`, `finance`, `twitter`, `video`

## MCP Server

Auto-configure AISA's MCP server for your AI agents:

```bash
aisa mcp setup                          # configure all detected agents
aisa mcp setup --agent cursor           # Cursor only
aisa mcp setup --agent claude-desktop   # Claude Desktop only
aisa mcp status                         # check configuration
```

## Configuration

```bash
aisa config set defaultModel claude-opus-4-6   # change default model
aisa config get defaultModel                    # read a value
aisa config list                                # show all settings
aisa config reset                               # reset to defaults
```

Settings:
- `defaultModel` — default model for `aisa chat` (default: `gpt-4.1`)
- `baseUrl` — API base URL (default: `https://api.aisa.one`)
- `outputFormat` — output format: `text` or `json`

Environment variable `AISA_API_KEY` takes precedence over stored key.

## Known Issues

**GPT-4.1 streaming returns empty output.** The AISA gateway currently strips `choices[].delta.content` from GPT model SSE chunks, so streaming mode produces blank output for GPT models. Workaround: use `--no-stream` or switch to Claude/Qwen models which stream correctly. Non-streaming GPT works fine.

## Development

```bash
git clone https://github.com/AIsa-team/cli.git
cd cli
npm install
npm run build       # compile TypeScript
npm run dev         # watch mode
npm test            # run tests
```

## Appendix: Architecture Notes for Contributors

**Two base URLs.** The AISA platform uses separate base paths:
- LLM endpoints (chat, models): `https://api.aisa.one/v1/`
- Domain API endpoints (search, finance, twitter, video): `https://api.aisa.one/apis/v1/`

The `domain: true` option in `RequestOptions` (see `src/api.ts`) selects which base URL to use. The `run` command auto-detects based on the slug prefix.

**Parameter naming varies by endpoint.** Smart/full search uses `q`, scholar uses `query`, finance uses `ticker` (not `symbol`), Twitter uses `userName` (camelCase). Always check the [API Reference](https://docs.aisa.one/reference) for exact parameter names.

**Video generation is async.** POST to `/services/aigc/video-generation/video-synthesis` with header `X-DashScope-Async: enable`, then poll `GET /services/aigc/tasks?task_id=<id>` for status. Response shape uses `output.task_id`, `output.task_status`, `output.video_url`.

**Twitter write operations require login cookies.** `create_tweet_v2` and other action endpoints need `login_cookies` and `proxy` fields — they don't work with just the API key.

**Models API follows OpenAI format.** The `/v1/models` endpoint returns `owned_by` (not `provider`) and has no `name`, `pricing`, or `contextWindow` fields.

**Some financial endpoints return empty data.** `financial/prices` and `financial/financial-metrics/snapshot` return `{}` for all tickers (backend issue). The default `aisa stock` now fetches `company/facts` + `analyst-estimates` + `news` instead. Working fields: `info`, `estimates`, `financials`, `filings`, `insider`, `institutional`, `news`.

## License

MIT
