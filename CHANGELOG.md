# Changelog

All notable changes to `@aisa-one/cli` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.3] — 2026-08-07

Every command documented in the README was checked against the live gateway.
Eight were broken. This release fixes everything that the gateway already
supports today; nothing here depends on a backend change.

### Added

- **`aisa run --show-cost`** prints the gateway's billing headers
  (`X-AISA-Price-USD`, accounted/estimated credits, credit model, pricing
  strategy, price key, request id) on stderr, leaving `--raw | jq` a clean
  pipe. Metered providers are the reason it exists: DataForSEO and Jina bill
  per consumed credit, but `/info/apis` reports every provider's pricing as
  flat `per_request`, so the headers are the only accurate record of what a
  call cost. Routes that report no amount say so explicitly rather than
  printing nothing, which would read as "this was free".

- **Shell completion.** `aisa completion <bash|zsh|fish>` prints an installable
  script; with no argument it detects the shell from `$SHELL`. Beyond commands
  and flags it completes provider slugs, a provider's endpoints, skill names,
  and model ids from the local cache. Completion never makes a network request —
  a cold cache simply offers no dynamic values rather than stalling the prompt.
- **`aisa api list` / `show` / `search` / `code` now work.** They read the
  public `/info/apis` catalog — 29 providers, 950+ endpoints — and **no longer
  require an API key**, so the catalog is browsable before signup. Note that a
  provider's id is not always its URL slug (`brave-search` serves
  `/apis/v1/brave/...`); `api show` prints the runnable path.
- **`aisa cache clear` / `cache path`** for the on-disk catalog and skills
  cache (`~/.aisa/cache`, overridable with `AISA_CACHE_DIR`). Most commands
  accept `--refresh` to bypass it.
- **`aisa run --llm` / `--domain`** to override base-URL detection.
- **`aisa video create` now builds the right request body per model family.**
  The gateway rewrites only the top-level `model` and forwards the rest, so the
  body belongs to the owning vendor: Seedance needs a `content` array and
  rejects the Bailian `input`/`parameters` shape with a 400, while i2v and r2v
  models need `input.media[]`. New `--image` (shorthand for
  `--media first_frame=<url>`), `--media <type=url>` covering `first_frame`,
  `last_frame`, `driving_audio` and `first_clip`, and `--body '<json>'` as a
  verbatim escape hatch. A model that needs source media now fails immediately
  instead of being accepted, billed, and failing upstream a minute later.
- **`aisa video create --resolution` / `--duration`**, and `--output` now
  actually downloads the finished clip (it was previously accepted and ignored).
- **`aisa screener --min-market-cap` and `--filter field:op:value`**; sector
  names are normalised to GICS, so `--sector Technology` resolves to
  `Information Technology` rather than silently matching nothing.
- **`aisa crypto --id` and `--source`**; `aisa skills install --force`;
  `aisa skills list --category` / `--limit` (previously accepted and ignored).
- `GITHUB_TOKEN` / `GH_TOKEN` is used for skills-registry requests when set,
  raising the GitHub rate limit from 60/hr to 5000/hr.

### Fixed

- **`aisa run` reached only 6 of 29 providers.** The slug whitelist listed nine
  entries, two of which (`services`, `crypto`) do not exist, and everything
  outside it was sent to the LLM gateway and 404'd. Detection is inverted: the
  whitelist now covers LLM gateway routes, which are hardcoded server-side, and
  everything else defaults to the integration base — so newly added providers
  work without a CLI release. A 404 now suggests near-miss slugs.
- **`aisa run classify ...` reached the wrong base.** The gateway serves
  `POST /v1/classify` (Jina classification), but it was missing from the LLM
  route whitelist, so `run` treated `classify` as a provider slug and sent it
  to `/apis/v1/classify` — a 404 with "api endpoint not found". The whitelist
  is now pinned to the server's route table by a test that lists every
  registered `/v1` segment.
- **Every `aisa skills` subcommand except `init` returned nothing.** The
  registry read only the top level of a repo that nests skills two deep, so it
  treated the six category directories as skills. Slugs are now derived from
  `SKILL.md` locations at any depth, all 42 skills are listed, and a bare name
  (`marketpulse`) resolves to its canonical slug. The repo tree is fetched once
  per process and cached for an hour instead of being re-fetched per command.
- **`aisa video create` and `video status` always 404'd.** They called
  `/apis/v1/services/aigc/...`, a provider that does not exist; the real
  endpoints are `POST /v1/video/generations` and
  `GET /v1/video/generations/:task_id`. The default model `wan2.6-t2v` also did
  not exist. Polling checked for `PENDING`/`RUNNING`, which the current status
  enum never returns, so `--wait` exited immediately as a failure. Task ids are
  now the gateway's own `video_task_<hex>` — ids saved from 0.2.2 will report
  `task not found`, since they never worked in the first place.
- **`aisa screener` 404'd** — the path was missing its `/screener` suffix and
  used the wrong method — and it sent an empty filter set, which the upstream
  rejects.
- **`aisa web-search` defaulted to a broken backend.** `smart` and `full` return
  an upstream 404 for every parameter shape; the default is now `tavily`. The
  same stale example was baked into the `skills init` search template, which
  would have taught agents to call the broken endpoint.
- **`aisa crypto` returned `403 Crypto access restricted`.** It now uses the
  coingecko provider, which is healthy and cheaper, with a symbol → coin-id
  table; ambiguous symbols list candidates instead of guessing.
- **`aisa config set baseUrl` only affected half the requests.** Integration
  calls hardcoded their base. All three bases are now derived from one root,
  and `config list` shows what they resolve to. Existing configs holding the
  historical `https://api.aisa.one/v1` default keep working.
- **`aisa skills install` now replaces the target directory instead of merging
  into it**, so a previous skill's scripts and assets cannot linger and keep
  being loaded by an agent. A partial download aborts the whole install and
  leaves the existing directory untouched, rather than replacing a working
  skill with an incomplete one. Installs record the canonical slug in
  `.aisa-skill.json`: frontmatter `name:` is not an identity, and two skills in
  different categories sharing a leaf name would otherwise overwrite each other
  silently. `aisa skills remove <category>/<name>` checks that marker before
  deleting, so it cannot take out a same-named skill from another category.
  Naming a category means "this specific skill", so both install and remove
  refuse to touch a directory whose ownership they cannot verify — including
  ones installed before markers existed; `--force` overrides. A bare name still
  works unguarded, since it only resolves when the leaf name is unique.
- Binary files in a skill (images, fonts) are no longer corrupted on install by
  a UTF-8 round trip.
- Sub-cent prices no longer display as `$0.00` — real catalog values go down to
  `$0.000001`.

### Changed

- `aisa api code` defaults to `--lang curl` (was `typescript`) and never
  interpolates your real key — snippets read `AISA_API_KEY` from the
  environment. The catalog reports every method as `GET` server-side, so the
  generated method is advisory; use `--method` to override.
- `tests/` is no longer published to npm (the package now ships an explicit
  `files` allowlist), and `npm run build` cleans `dist/` first so stale
  artefacts cannot ship.

### Known issues

- **`aisa usage` still reports that the API is unavailable.** The gateway does
  not serve `GET /v1/credits/usage` — it 404s in production even though
  `/v1/credits/balance` on the same route group works. The CLI side is
  unblocked and will be wired up once that route ships.
- `aisa mcp setup` writes `https://docs.aisa.one/mcp`, a domain with no DNS
  record, and **overwrites your agent's MCP config if it cannot parse it** —
  a file with comments or a trailing comma will be emptied. This release does
  not touch the MCP commands; avoid `aisa mcp setup` until it is fixed.
- `web-search --type smart` and `--type full` remain degraded upstream.

## [0.2.2] — 2026-08-03

### Added

- **`aisa balance` now queries the live account wallet through the API-key
  balance endpoint.** It reports both the account balance and the amount
  available to the current API key, with `--json` support for automation.

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

[Unreleased]: https://github.com/AIsa-team/cli/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/AIsa-team/cli/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/AIsa-team/cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AIsa-team/cli/releases/tag/v0.2.1
[0.2.0]: https://github.com/AIsa-team/cli/releases/tag/v0.2.0
