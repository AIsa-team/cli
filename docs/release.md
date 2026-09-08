# Releasing `@aisa-one/cli`

Operator checklist for tagging a reviewed `main` commit. Tag only after
that commit is merged and reviewed. A push to `main` runs CI only;
`git push origin vX.Y.Z` starts the Release workflow.

## Candidate

| Item | Value |
| --- | --- |
| Version | `0.4.0` (unpublished candidate; recheck registry before tagging) |
| Command surface | 22 root help entries including implicit `help`; `api` is `list`/`show` only |
| Registry latest (recheck before tagging) | `0.3.0` on `https://registry.npmjs.org` |
| Default Router origin | `https://tools.aisa.one` |
| LLM / catalog host | `https://api.aisa.one` |
| Node | `engines` `>=18`. CI on Ubuntu: 18/20 legacy compatibility, 22/24 maintained, 26 current. Publish job uses Node 24 and npm `11.6.0`. |

`package.json`, `package-lock.json` (root / `packages[""]`),
`src/constants.ts` `VERSION`, installed `aisa --version`, and
`CHANGELOG.md` `## [0.4.0]` must agree. Confirm with
`node scripts/package-smoke.mjs` (or `--tarball` of the candidate
archive). The VS Code extension is not version-bumped with this CLI
release unless its own packaging requires it.

The packed archive must include `dist/index.js`, the `aisa` bin, and
`LICENSE` (MIT, Copyright (c) 2026 AIsa Team).

## Trusted Publisher

Before the first tag that should ship, configure npm Trusted Publisher
on `https://www.npmjs.com/package/@aisa-one/cli` → Settings → Trusted
Publisher:

- Repository: `AIsa-team/cli`
- Workflow: `release.yml`

Do not add a stored npm token, disable 2FA, or change GitHub
`id-token` permissions. Until this is configured, the publish step 403s
and the tag is harmless. Do not treat OIDC publish as already proven.

## Tag from reviewed main

```bash
# Official registry only — do not use a mirror as the source of truth.
npm view @aisa-one/cli version --registry https://registry.npmjs.org
# expected while 0.4.0 is unpublished: 0.3.0

git checkout main
git pull origin main
# Confirm this commit is the reviewed merge of the 0.4.0 candidate.
node -p "require('./package.json').version"   # 0.4.0
grep -E '^export const VERSION' src/constants.ts   # "0.4.0"

git tag -a v0.4.0 -m "v0.4.0"
git push origin v0.4.0
```

Do not tag a worktree or unmerged branch. Do not run `npm publish` on a
laptop. Do not retag or force-push `v0.4.0`. Do not push a tag whose
`v*` suffix differs from `package.json` `version` (the workflow refuses
that mismatch).

## What the Release workflow publishes

The job does not run `npm publish` on the source tree (that would pack
again via `prepack`). It:

1. Checks the tag against `package.json`.
2. Installs npm `11.6.0`, then `npm ci` and `npm test`.
3. Builds and smokes one tarball:
   `node scripts/package-smoke.mjs --output "$RUNNER_TEMP/aisa-cli-release"`
4. Publishes that same file:
   `npm publish "$RUNNER_TEMP/aisa-cli-release/artifacts/aisa-one-cli-${version}.tgz"`

Local smoke of an existing archive:

```bash
node scripts/package-smoke.mjs --tarball /path/to/aisa-one-cli-0.4.0.tgz
```

`prepack` (`npm run build`) is what puts `dist/` into a clean `npm pack`.
CI still runs an explicit `npm run build` before `npm test`.

## After the tag

Watch the Release workflow. Success is `0.4.0` on
`https://registry.npmjs.org/@aisa-one/cli`. A 403 means Trusted Publisher
is still missing — configure it on npmjs.com, then decide whether to
re-run the workflow on the same tag.
