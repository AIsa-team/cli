# CLI / MCP Router parity harness (Mock E2E, default-off)

Cross-entry check: a compiled AIsa CLI, the pinned Router HTTP adapter, and the pinned Router MCP adapter share one real `toolrouter.Service` against a local catalog and AIsaServices stub. This is Mock E2E. It does not call paid, network, or production backends.

`npm test` / CI do not run this workflow.

## Pin

Router SHA: see `router.pin`

```
0a72bf83e557b216e4287c37a06ad88816994f40
```

The harness clones Router source into a temporary directory, copies `router-overlay/` into the clone only, `go build`s a temp `parity-router` binary, and **spawns that binary directly** (not `go run`). SIGTERM/SIGKILL waits for the child to exit before deleting the temp tree. The clone is never committed. The source checkout is read-only.

## Router source (required)

There is no default machine-local snapshot path. Set one of:

| Variable | Meaning |
| --- | --- |
| `AISA_ROUTER_SNAPSHOT` | Local Router checkout. Cloned with `git clone --local`; then the pin is checked out. |
| `AISA_ROUTER_REPO` | Git URL or local repo path to clone, then check out the pin. Documented remote: `https://github.com/AIsa-team/aisa-tool-router.git` |

If neither is set, the harness exits 2. Do not rely on a developer-specific `/tmp/...` path unless you pass it explicitly as `AISA_ROUTER_SNAPSHOT`.

## Prerequisites

- Node >= 18
- Go toolchain able to run `GOTOOLCHAIN=go1.26.0` (Go 1.24+ with the 1.26 toolchain in `GOPATH/pkg/mod`)
- Git
- A built CLI binary or `dist/index.js`
- Router source via `AISA_ROUTER_SNAPSHOT` or `AISA_ROUTER_REPO` at the pin

No Docker. No production credentials.

## Invoke

From the CLI repository root, after `npm ci && npm run build` or with an explicit binary:

```bash
AISA_ROUTER_SNAPSHOT=/path/to/router-checkout tests/e2e/run.sh --cli dist/index.js
# or
AISA_ROUTER_REPO=https://github.com/AIsa-team/aisa-tool-router.git tests/e2e/run.sh --cli dist/index.js
```

`run.sh` accepts a JS entry (`node dist/index.js …`) or an executable. Parent should pass the CLI produced after core integration.

Optional:

```bash
AISA_CLI=/path/to/built/aisa AISA_ROUTER_SNAPSHOT=/path/to/router-checkout tests/e2e/run.sh
tests/e2e/run.sh --cli dist/index.js --skip-build
```

## Environment the CLI must honor

The harness sets the canonical Router origin to the loopback overlay and does not inherit Router settings from the parent shell:

| Variable | Role |
| --- | --- |
| `AISA_ROUTER_BASE_URL` | Canonical Router origin. |
| `AISA_API_KEY` | Bearer credential. Unset for anonymous discovery and local-auth-rejection cases. Fixture value is `caller-key` (not a real key). Never inherited from the parent shell. |

POST `${origin}/v1/tool-router/<operation>`. Independent of `/apis/v1` and LLM `/v1`.

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

CLI shell exits used here (plan contract): **0** complete success, **3** returned batch with any failed item, **1** local missing-key rejection (quote/call without credential).

## Comparison semantics

HTTP and MCP application payloads are always compared after wiping `search_id`, `batch_id`, and `request_id`. Precision is asserted on the raw JSON token, not `JSON.parse` numbers.

### Payload parity (default)

`search_anonymous`, `schema_partial`, `quote_partial_precision`, `quote_stdin`, `call_success`:

- lossless CLI stdout vs HTTP application JSON
- exact CLI exit **0** (complete success) or **3** (partial batch)
- dispatch counts
- precision token when required

A false success (exit 0 on a partial batch) is RED.

### Local-auth-rejection (not payload parity)

`quote_auth_required` and `call_auth_required`:

- HTTP vs MCP: still compare the **401 application** payload and assert zero dispatch
- CLI is **not** compared to that 401 body. The missing-key gate is intended local CLI behavior
- CLI must satisfy **all** of:
  - exit exactly **1**
  - empty stdout
  - stderr contains the missing-key diagnostic (`No API key found`, `aisa login`, and `AISA_API_KEY`)
  - zero dispatch (no quote/execute POST)

Any other failure (unknown command, unknown option, network error, 401 JSON on stdout, wrong exit, or a dispatch) is RED. An arbitrary nonzero error is not success.

## Cases

1. Anonymous search — no credential, payload parity, exit 0, no upstream quote/execute.
2. Schema partial — `getFacts` + `missing`, payload parity, exit 3.
3. Quote without credential — HTTP/MCP 401 application payload, zero dispatch; CLI local-auth-rejection (exit 1, empty stdout, missing-key diagnostic, zero dispatch).
4. Authorized mixed quote — payload parity, exit 3, order preserved, one per-item failure, `estimated_cost_micros_usd` stays `9007199254740993`, 3 quotes / 0 executes.
5. Quote via stdin (`-f -`) — same payload, exit 3, and dispatch as case 4.
6. Call without credential — HTTP/MCP 401 application payload, zero execute; CLI local-auth-rejection.
7. Authorized call — payload parity, exit 0, one execute, no quote.

## Exit status

| Code | Meaning |
| --- | --- |
| 0 | HTTP/MCP payload+dispatch match, and every CLI case meets its payload or local-auth-rejection contract |
| 1 | Router HTTP/MCP GREEN; at least one CLI case failed its contract |
| 2 | Harness or Router overlay failed (including unset Router source) |

## What this does not prove

Deployed auth, live billing, model behavior, or parser/help/deprecation text.
