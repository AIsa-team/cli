# Changelog

All notable changes to `@aisa-one/cli` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`aisa plan`** — a generic resource-plan command group: a local pre-flight
  manifest plus credit quote for an upcoming run. Upstream agents add items
  bound to a `capability@version` and a typed scope; the CLI checks the
  manifest and quotes it against verified public pricing
  (`authority=local_preview`). This is not a server-side quote, does not
  reserve credits, and is not a spend lock. Plans are data — no
  conditionals, loops, or dataflow. Items that depend on an upstream result
  are placeholders (capability + spend ceiling); `item-replace` materialises
  them. Stored at `~/.aisa/plans/<plan_id>.json` (override with
  `AISA_PLAN_DIR`). Subcommands: `create`, `list`, `show`, `discover`,
  `add`, `item-replace`, `item-remove`, `set-budget`, `check`, `quote`,
  `delete`. See [docs/plans.md](docs/plans.md).

- **`aisa connect`** — a one-shot local page (`npx @aisa-one/cli connect`) to
  wire AIsa MCP servers into local coding agents. Detects Claude Code, Cursor,
  Claude Desktop and Windsurf; Claude Code entries go through `claude mcp add`
  (user scope), the rest through the same config writer as `mcp setup`. The
  process serves one token-guarded page on 127.0.0.1, applies the selection,
  drives the sign-in, and exits — no daemon left behind. With no key stored,
  the run starts with one browser approval (the same flow as `aisa login`)
  that mints the durable CLI key; every MCP entry and the model provider are
  then written with it — no per-server authorization popups. Only if that
  sign-in fails does connect fall back to each client's own OAuth machinery
  (`claude mcp login` per server; `codex mcp add` runs its own flow). A
  configured key skips the sign-in entirely.
  The page follows the AIsa Console design (warm dot-grid, Inter, the
  Console red), groups servers by category with their manifest descriptions,
  shows per-server authorization progress live, and finishes by opening a
  success page with copy-paste example prompts that name each `aisa-*`
  server explicitly so the request routes to AIsa.
- **`aisa topup [amount]`** — opens the console billing page to add credit,
  deep-linking `?amount=` when one is given and rejecting anything that is not
  a positive number of dollars. Payment finishes in the browser by necessity
  (Stripe's hosted page owns the card details; 3-D Secure needs a browser).
  `aisa balance` now points at it when the account is out of credit.
- **`aisa login` signs in over OAuth and keeps a real key.** With no
  arguments it opens the browser for one approval, then trades the access
  token for the long-lived CLI key at `POST /v1/keys/mint` and stores only
  the key. `--no-browser` prints the URL and reads the redirect back for
  headless machines; `--key <key>` still stores one directly.
- **Codex MCP entries carry the key itself, not an env-var name.**
  `codex mcp add --bearer-token-env-var` records only a variable name that
  nothing guarantees a shell exports, so keyed entries could 401 at runtime.
  After the add (which the flag keeps free of OAuth popups), the entry is
  patched to a literal `http_headers` Authorization — the same thing the
  Claude Code path stores via `--header`.
- CI on every push/PR (build + tests), and a tag-triggered release workflow that
  publishes to npm via Trusted Publishing (OIDC — no stored token, 2FA stays on).
  From the next release, `git push origin vX.Y.Z` is the publish button.

### Fixed

- **`formatPrice` no longer renders a 0 catalog price as "free".** Zero now
  displays as `unpriced (dynamic)`, so metered or unknown prices are not
  mistaken for a complimentary call.

## [0.3.0] — 2026-08-18

### Fixed

- **`aisa mcp setup` wrote a dead URL.** It hardcoded
  `https://docs.aisa.one/mcp`, a hostname with no DNS record, and wrote it
  into every client's config. Setup now reads the live discovery manifest at
  `aisa.one/.well-known/mcp.json` and writes one entry per live server
  (default set of five; `--all` for everything), so new servers work without
  a CLI release. If the manifest cannot be fetched, nothing is written.
- **`{url}` entries were written for clients that cannot execute them.**
  Claude Desktop and Windsurf spawn stdio processes and silently ignore url
  entries; they now get an `npx mcp-remote` bridge, verified end to end
  against production.
- **A config file that failed to parse was replaced with `{}`.** A
  hand-edited `mcp.json` with comments or a trailing comma was wiped by
  setup. It is now left untouched, with an error.

### Added

- Entries carry the configured API key as a Bearer header; without a key
  they are written credential-less and the server's OAuth challenge drives
  the browser flow on first use.
- `aisa mcp status` now pings every configured endpoint with a real
  initialize request instead of checking that a JSON key exists — a 401 is
  reported as healthy (the auth challenge), an unresolvable hostname as the
  failure it is.
- The stale dead entry earlier releases wrote is removed on the next setup.

## [0.2.4] — 2026-08-07

Text-only follow-up to 0.2.3: no behavioural change, but the URL it printed
sent people to a 404.

### Fixed

- **`aisa usage` and `aisa login` pointed at `aisa.one/dashboard`, which
  returns 404.** The customer console is served at `console.aisa.one`; the
  API-key and usage-log pages are `/api-keys` and `/logs`. Both commands and
  both README references now say so.

### Changed

- **The brand is written `AIsa`, not `AISA`,** in `--help` output, the npm
  package description, the skill templates, and the README. The `AISA_*`
  environment variables and `X-AISA-*` response headers are technical
  identifiers and keep their existing casing.

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

[Unreleased]: https://github.com/AIsa-team/cli/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/AIsa-team/cli/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/AIsa-team/cli/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/AIsa-team/cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AIsa-team/cli/releases/tag/v0.2.1
[0.2.0]: https://github.com/AIsa-team/cli/releases/tag/v0.2.0
