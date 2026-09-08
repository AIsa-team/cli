# Isolated package smoke

Real CLI / Workflow check: build the current checkout (or take an existing tarball), `npm pack`, install that archive into a throwaway prefix, and invoke the **installed** `aisa` bin. The process cwd is an empty temp directory, not the source checkout.

This entry does not publish, tag, or `npm install -g`. It is not wired into `npm test`.

Core writers own `package.json`, version bumps, and CI. This script only consumes them.

## Invoke

From the CLI repository root, Node >= 18:

```bash
node scripts/package-smoke.mjs
```

Default path: `npm ci` if `node_modules` is missing; then `npm pack` (via `prepack` when that script exists, otherwise `npm run build` then pack); isolated `npm install --prefix`; then probes. Installed CLI probes use async `spawn` so the in-process loopback server can answer. Dependencies come from the npm registry. No live paid APIs.

```bash
node scripts/package-smoke.mjs --tarball /path/to/aisa-one-cli-0.4.0.tgz
node scripts/package-smoke.mjs --output /tmp/cli-smoke-out
node scripts/package-smoke.mjs --keep-output
node scripts/package-smoke.mjs --live-discovery
node scripts/package-smoke.mjs --tarball /tmp/aisa-cli-release-candidate-040/artifacts/aisa-one-cli-0.4.0.tgz --live-discovery
```

| Flag | Effect |
| --- | --- |
| `--tarball FILE` | Skip build/pack; inspect and install this archive |
| `--output DIR` | Write the tarball copy, install prefix, and `report.json` here (kept) |
| `--keep-output` | Keep the temp artifact directory |
| `--live-discovery` | Default-off Real API E2E on the installed bin |

Stdout is a JSON report. `report.json` is also written into the artifact directory when that directory is kept.

## Version

The candidate version is **inferred**, not hardcoded:

- Default: `package.json` `version` of this checkout
- `--tarball`: version inside the packed `package/package.json`

When packing from this checkout, `package.json`, `package-lock.json`, `src/constants.ts` `VERSION`, the packed metadata, and `aisa --version` must all equal that candidate. `--tarball` compares the packed metadata to the installed `--version` only.

## What it checks

- Tarball contains `package.json`, `dist/index.js`, `README.md`, and the `aisa` bin; excludes `src/` and `tests/`
- `package.json` `license` is `MIT`. The tarball must contain the MIT `LICENSE`; when packing this checkout, the text must match the source file. A missing license is a failure.
- Isolated `HOME` / `XDG_*` / `TMPDIR`; parent `AISA_*` is never forwarded
- Installed `--version`, `--help`, and `manifest` (22 root help entries including implicit `help`; `api` exposes `list` / `show` only; those two are not deprecated)
- Removed names (`web-search`, `scholar`, `stock`, `crypto`, `screener`, `tweet`, `twitter`, `video`, `run`, `code`, `api search`, `api code`) are unknown and absent from help/manifest
- Local usage errors (exit 2) and quote-without-key (exit 1, empty stdout, missing-key diagnostic) do not dispatch
- Controlled loopback HTTP for installed `search` / `schema` / `quote` / `call`: `--input`, `-f FILE`, `-f -`, `--json` stdout is the unmodified application body. Only `AISA_ROUTER_BASE_URL` is set (no `AISA_ROUTER_URL` alias).
- Partial schema → exit 3; quote keeps the `9007199254740993` token; quote does not follow a 307
- Quote/call use only the fake key `local-smoke-key`

## Live discovery (default off)

`--live-discovery` is Real API E2E. It is not part of the default local run.

After local stub probes, the same installed bin is invoked with isolated `HOME` / `XDG_*` and **no** `AISA_API_KEY`, **no** inherited `AISA_*`, and **no** `AISA_ROUTER_BASE_URL` override (the packaged default origin). It:

1. runs `aisa search "company profile" --limit 1 --json`
2. takes the first returned `tools[].tool` name exactly
3. runs `aisa schema <that-tool> --json` and requires `successful` plus `arguments_schema`

It never runs `quote` or `call`. Those checks are labeled `loop: "Real API E2E"` in the report; local stub checks are unlabeled. Pass `--tarball` to verify an existing candidate artifact.

## Reuse existing Router parity

Do **not** copy `tests/e2e`. After a kept run, the report's `install_bin` is the artifact to pass through:

```bash
AISA_ROUTER_SNAPSHOT=/path/to/router-checkout \
  tests/e2e/run.sh --cli "$INSTALL_BIN" --skip-build
```

## Exit status

| Code | Meaning |
| --- | --- |
| 0 | Pack, install, and every probe passed |
| 1 | Artifact installed; at least one behavior check failed |
| 2 | Build, pack, install, or other harness failure |

npm failures include the command, cwd, exit, and stderr.

## Platform claims

`engines` is `node >= 18`. Source CI is expected to build on Ubuntu with Node 18/20/22/24/26. A local run only proves the Node and OS recorded in `tested`. Do not treat one macOS run as Ubuntu-matrix evidence.
