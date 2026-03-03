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
aisa api list                                # list all API endpoints
aisa api list --category finance             # filter by category
aisa api search "email finder"               # natural language search
aisa api show finance /stock/price           # endpoint details + params
aisa api code finance /stock/price --lang python  # generate code snippet

# Execute any API
aisa run finance /stock/price -q "symbol=AAPL"
aisa run tavily /search -d '{"query": "AI news"}'
aisa run twitter /tweet/advanced-search -q "query=AI agents" --raw
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
aisa stock AAPL                     # stock price
aisa stock MSFT --field earnings    # earnings data
aisa stock TSLA --field filings     # SEC filings
aisa stock NVDA --field insider     # insider trades
aisa crypto BTC                     # crypto price
aisa crypto ETH --period 30d       # historical
aisa screener --sector Technology   # stock screener
```

### Twitter/X

```bash
aisa tweet "Hello world!"                   # post a tweet
aisa tweet "Reply" --reply-to 123456        # reply
aisa twitter search "AI agents" --limit 20  # search tweets
aisa twitter user elonmusk                  # user profile
aisa twitter trends                         # trending topics
```

### Video Generation

```bash
aisa video create "A sunset timelapse"           # create task
aisa video create "Dancing robot" --wait         # wait for result
aisa video status <task-id>                      # check status
```

### Account

```bash
aisa balance                # credit balance
aisa usage --limit 20       # usage history
aisa usage --days 7         # last 7 days
```

## Skills

Skills are markdown files that teach AI coding agents (Claude Code, Cursor, Copilot, etc.) how to use AISA APIs.

### Browse & Install

```bash
aisa skills list                              # browse skills
aisa skills search "financial analysis"       # search
aisa skills show aisa-team/finance-analyst    # details
aisa skills add aisa-team/finance-analyst     # install to all agents
aisa skills add aisa-team/llm-assistant --agent claude  # specific agent
aisa skills remove aisa-team/finance-analyst  # uninstall
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
aisa skills init my-skill                          # create from default template
aisa skills init my-skill --template finance       # finance template
aisa skills init my-skill --template llm           # LLM template
aisa skills submit ./my-skill                      # submit to AISA
aisa skills push owner/my-skill                    # push updates
aisa skills request-verification owner/my-skill    # request review
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

## Development

```bash
git clone https://github.com/AIsa-team/cli.git
cd cli
npm install
npm run build       # compile TypeScript
npm run dev         # watch mode
npm test            # run tests
```

## License

MIT
