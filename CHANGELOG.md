# Changelog

All notable changes to `@aisa-one/cli` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Skills registry now points at the canonical `agent-skills` repo.** The
  `SKILLS_REPO` constant in `src/commands/skills.ts` was pinned to
  `AIsa-team/OpenClaw-Skills`, which has been renamed to
  `AIsa-team/agent-skills`. Every `aisa skills` subcommand kept working
  only because GitHub serves a 301 redirect on the old slug; the constant
  now references the canonical name so the registry no longer depends on
  that redirect. ([#3](https://github.com/AIsa-team/cli/pull/3))
- **`aisa skills list` and `aisa skills show` now render emojis for live
  skills.** `parseSkillFrontmatter` only read `metadata.openclaw.emoji`,
  but skills in `agent-skills` publish under `metadata.aisa.emoji`. The
  parser now reads the new key first and falls back to the legacy
  `openclaw` key for any older skills still in the wild.
  ([#4](https://github.com/AIsa-team/cli/pull/4))

### Changed

- **`aisa skills init` templates aligned with `agent-skills` conventions.**
  All six built-in scaffolds (`default`, `llm`, `search`, `finance`,
  `twitter`, `video`) now emit:
  - `homepage: https://aisa.one` (was `https://openclaw.ai`)
  - `metadata.aisa.*` instead of `metadata.openclaw.*`
  - `compatibility: ["openclaw", "claude-code", "hermes"]` to match the
    shape used by `marketpulse`, `multi-source-search`,
    `prediction-market-arbitrage`, and the rest of the live skills.

  Skills scaffolded with `aisa skills init` will now render correctly in
  the registry and pass review when contributed back upstream.
  ([#5](https://github.com/AIsa-team/cli/pull/5))

### Documentation

- README Skills section now references
  [`AIsa-team/agent-skills`](https://github.com/AIsa-team/agent-skills)
  directly instead of the renamed `OpenClaw-Skills`.
  ([#2](https://github.com/AIsa-team/cli/pull/2))

## [0.2.0] — Initial public release

- LLM gateway commands (`aisa chat`, `aisa models`).
- API discovery and execution (`aisa run`, `aisa api …` WIP).
- Web search (`aisa web-search`, `aisa scholar`).
- Finance (`aisa stock`, `aisa crypto`, `aisa screener`).
- Twitter/X (`aisa twitter …`, `aisa tweet`).
- Video generation (`aisa video create|status`).
- Skills registry (`aisa skills list|search|show|install|remove|init`).
- MCP server auto-config (`aisa mcp setup|status`).
- Config commands (`aisa config get|set|list|reset`) and auth
  (`aisa login|logout|whoami`).

[Unreleased]: https://github.com/AIsa-team/cli/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/AIsa-team/cli/releases/tag/v0.2.0
