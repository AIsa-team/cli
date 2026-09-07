# CLI / MCP Router parity harness (Mock E2E, default-off)

Cross-entry check: a compiled AIsa CLI, the pinned Router HTTP adapter, and the pinned Router MCP adapter share one real `toolrouter.Service` against a local catalog and AIsaServices stub. This is Mock E2E. It does not call paid, network, or production backends.

`npm test` / CI do not run this workflow.

## Pin

Router SHA: see `router.pin`

```
0a72bf83e557b216e4287c37a06ad88816994f40
```

Default snapshot (read-only; never modified or committed):

```
/tmp/aisa-cli-mcp-audit.h2pKoy/router
```

The harness clones that tree into a temporary directory, copies `router-overlay/` into the clone only, `go build`s a temp `parity-router` binary, and **spawns that binary directly** (not `go run`). SIGTERM/SIGKILL waits for the child to exit before deleting the temp tree. The clone is never committed.

## Prerequisites

- Node >= 18
- Go toolchain able to run `GOTOOLCHAIN=go1.26.0` (Go 1.24+ with the 1.26 toolchain in `GOPATH/pkg/mod`)
- Git
- A built CLI binary or `dist/index.js`
- Router source at the pin: `AISA_ROUTER_SNAPSHOT` (default above) or `AISA_ROUTER_REPO`

No Docker. No production credentials.

## Invoke

From the CLI repository root, after `npm ci && npm run build` or with an explicit binary:

```bash
tests/e2e/run.sh --cli dist/index.js
# or
AISA_CLI=/path/to/built/aisa tests/e2e/run.sh
```

`run.sh` accepts a JS entry (`node dist/index.js …`) or an executable. Parent should pass the CLI produced after core integration.

Optional:

```bash
AISA_ROUTER_SNAPSHOT=/path/to/router-checkout tests/e2e/run.sh --cli dist/index.js
AISA_ROUTER_REPO=https://github.com/AIsa-team/aisa-tool-router.git tests/e2e/run.sh --cli dist/index.js
tests/e2e/run.sh --cli dist/index.js --skip-build
```

## Environment the CLI must honor

The harness sets **both** Router origin aliases to the same loopback overlay so a mid-integration CLI cannot fall through to `https://api.aisa.one`:

| Variable | Role |
| --- | --- |
| `AISA_ROUTER_BASE_URL` | Canonical Router origin. |
| `AISA_ROUTER_URL` | Also set to the same origin so mid-integration builds cannot fall through. |
| `AISA_API_KEY` | Bearer credential. Unset for anonymous discovery. Fixture value is `caller-key` (not a real key). Never inherited from the parent shell. |

If core later drops one alias, keep setting both until the remaining name is stable. POST `${origin}/v1/tool-router/<operation>`. Independent of `/apis/v1` and LLM `/v1`.

### Credential / Conf isolation

`HOME` alone is not enough on macOS: `conf` + `env-paths` reads `~/Library/Preferences/aisa-cli-nodejs`. The harness therefore:

- uses a throwaway `HOME` (covers `~/.aisa/key` and macOS Preferences)
- sets `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`
- does not forward the parent `AISA_API_KEY` or stored `routerUrl`
- fails closed if `os.homedir()` or the Conf path escapes the temp tree

## Assumed CLI public interface

Parser/deprecation coverage stays in ordinary command tests. This harness only drives `--json` application payloads.

| Command | Mapping | Invocation used here |
| --- | --- | --- |
| `aisa search` | `AISA_SEARCH_TOOL` / `POST /v1/tool-router/aisa-search-tool` | `search --input '<json>' --json` |
| `aisa schema` | `AISA_BATCH_GET_SCHEMA` / `POST /v1/tool-router/aisa-batch-get-schema` | `schema --input '<json>' --json` |
| `aisa quote` | `AISA_BATCH_QUOTE` / `POST /v1/tool-router/aisa-batch-quote` | `quote -f FILE --json` and `quote -f - --json` |
| `aisa call` | `AISA_BATCH_USE` / `POST /v1/tool-router/aisa-batch-use` | `call -f FILE --json` |

`--json` must write only the unmodified application JSON to stdout. Diagnostics go to stderr.

## Cases

1. Anonymous search — no credential, no upstream quote/execute.
2. Schema partial — `getFacts` + `missing`.
3. Quote without credential — HTTP 401, no dispatch.
4. Authorized mixed quote — order preserved, one per-item failure, `estimated_cost_micros_usd` stays `9007199254740993`, quote-only dispatch (3 quotes, 0 executes).
5. Quote via stdin (`-f -`) — same application payload and dispatch.
6. Call without credential — HTTP 401, no execute.
7. Authorized call — one execute, no quote.

HTTP and MCP application payloads are compared after wiping `search_id`, `batch_id`, and `request_id`. Precision is asserted on the raw JSON token, not `JSON.parse` numbers.

## Exit status

| Code | Meaning |
| --- | --- |
| 0 | HTTP, MCP, and CLI application payloads and dispatch all match |
| 1 | Router HTTP/MCP GREEN; CLI missing, wrong, or mismatched (expected baseline RED) |
| 2 | Harness or Router overlay failed |

Baseline before core integration: exit 1. `search` still hits the old catalog path; `schema` / `quote` / `call` are absent.

## What this does not prove

Deployed auth, live billing, model behavior, or parser/help/deprecation text.
