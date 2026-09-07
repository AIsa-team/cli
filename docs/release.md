# Releasing `@aisa-one/cli`

This file is the human publish procedure for a prepared candidate. Writing
or reading it is **not** authorization to merge, tag, or publish.

## Candidate this document describes

| Item | Value |
| --- | --- |
| Version | `0.4.0` |
| Registry latest (recheck before tagging) | `0.3.0` on `https://registry.npmjs.org` |
| Default Router origin | `https://tools.aisa.one` |
| LLM / catalog host (unchanged) | `https://api.aisa.one` |
| Supported Node | `engines` stay `>=18`. CI on Ubuntu only: 18/20 legacy compatibility, 22/24 maintained, 26 current. Publish job uses Node 24. |

`package.json`, `package-lock.json` (root / `packages[""]`),
`src/constants.ts` `VERSION`, `aisa --version`, and `CHANGELOG.md`
`## [0.4.0]` must agree. Confirm that with `npm run package:smoke` and
`aisa --version` after a clean pack, not with a dedicated version-echo
unit test. The VS Code extension is not version-bumped with this CLI
release unless its own packaging requires it.

The package `files` list includes `LICENSE`. A clean `npm pack` must
contain `LICENSE` (MIT, Copyright (c) 2026 AIsa Team) alongside `dist/`.

## Pack lifecycle

`prepublishOnly` does **not** run on `npm pack`. A clean tree that only
had that hook would ship a tarball without `dist/`.

This package uses a single lifecycle build:

```json
"prepack": "npm run build"
```

`prepack` runs before `npm pack` and before the pack step inside
`npm publish`. Do not also keep `prepublishOnly` or `prepare` for the same
build — that would compile twice on publish.

`npm run build` in CI is an explicit test step, not a second lifecycle hook.

## Package smoke interface

Owned by the package-smoke writer (`scripts/package-smoke.mjs` and
`docs/release-smoke.md`). This repository invokes it; it must not grow a
second copy of the script.

```bash
# Default: clean pack, isolated install, installed-bin checks
node scripts/package-smoke.mjs
# same:
npm run package:smoke

# Optional: skip packing and test an existing tarball
node scripts/package-smoke.mjs --tarball /path/to/aisa-one-cli-0.4.0.tgz
```

Default must prove **clean pack semantics**:

1. Do not rely on a leftover `dist/` from an earlier `npm run build`.
2. `npm pack` (which runs `prepack`) produces a tarball that contains
   `dist/index.js`, the `aisa` bin, and `LICENSE`.
3. Installing that tarball into an isolated prefix, with isolated
   `HOME` / `XDG_*` and no inherited `AISA_API_KEY`, runs the installed
   executable (version, help, manifest, file/stdin JSON as documented in
   `docs/release-smoke.md`).

CI (Node 18/20/22/24/26, Ubuntu) and the tag workflow call the default
form. They do not pass `--tarball`.

## Trusted Publisher (publish-time prerequisite)

The Release workflow already requests `id-token: write` and runs
`npm publish` with no `NODE_AUTH_TOKEN`. **That is not proof OIDC works.**
`gh run list --repo AIsa-team/cli --workflow release.yml` returned no
historical runs and therefore **no historical release.yml success**.
OIDC publish is unproven. npm `0.3.0` was published 2026-08-19
(`gitHead` `2b57cf72`) without this workflow firing.

Before the first tag that should ship, a maintainer must configure npm
Trusted Publisher on the **official** package page
(`https://www.npmjs.com/package/@aisa-one/cli` → Settings → Trusted
Publisher):

- Repository: `AIsa-team/cli`
- Workflow: `release.yml`

Do not add a stored npm token, do not disable 2FA, and do not change
workflow permissions to paper over a missing Trusted Publisher. Until
that configuration exists, `npm publish` from the workflow 403s and the
tag is harmless.

## Merge and tag (do not run from a preparation session)

Parent integrates `prepare/cli-0.4.0` and cherry-picks
`scripts/package-smoke.mjs` plus `docs/release-smoke.md` from
`test/cli-release-smoke` onto the PR20 branch
(`refactor/mcp-aligned-cli`). Then:

```bash
# 1. Recheck the official registry — do not use a mirror as the source of truth.
npm view @aisa-one/cli version --registry https://registry.npmjs.org
# expected while 0.4.0 is unpublished: 0.3.0

# 2. After review, merge the release-ready PR to main. Do not merge from here.

# 3. On origin/main, confirm the commit is the intended candidate:
git checkout main
git pull origin main
node -p "require('./package.json').version"   # 0.4.0
grep -E '^export const VERSION' src/constants.ts   # "0.4.0"

# 4. Annotated tag matching package.json. The tag is the publish button.
git tag -a v0.4.0 -m "v0.4.0"
git push origin v0.4.0
```

`git push origin v0.4.0` is the only intended publish trigger. A push to
`main` runs CI only.

Do **not**:

- run `npm publish` from a laptop
- retag or force-push `v0.4.0`
- push a tag whose `v*` suffix differs from `package.json` `version`
  (the workflow refuses that mismatch)
- change npm Trusted Publisher / GitHub `id-token` permissions as part of
  “trying again”

## After the tag

Watch the Release workflow. Success is `0.4.0` on
`https://registry.npmjs.org/@aisa-one/cli`. Failure with 403 and zero
prior Release runs means the Trusted Publisher is still missing — fix
that on npmjs.com, then (only with a new explicit publish authorization)
decide whether to reuse the same tag after the workflow can be re-run.

## Out of scope for this document

Paid Router quote/use, merging from a preparation agent, deployments,
and changing Router backend semantics.
