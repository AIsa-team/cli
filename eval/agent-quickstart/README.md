# Quickstart Skill ablation

Default-off 4×2 Pi ablation: four onboarding scenarios, with vs without the short AIsa Skill. **Not** `eval/cli-guidance`. Do not reuse those scores.

Install / `aisa login` / MCP are **Mock E2E** fixtures. Native npx, browser OAuth, and MCP OAuth are not claimed here. `search` / `schema` / `quote` / `call` use the existing Router stub. No production credentials; no unrestricted shell.

Required flags: `--docs` `--docs-sha` `--skill` `--skill-sha` `--install-meta` `--out`.

`--install-meta` is the `install-meta.json` written by `eval/cli-guidance/run.mjs` archive/pack (sha, tarball SHA-256, installed bin). Do not pass a free `--cli-bin`.

No-terminal setup source is the same for both arms: `read_guide` or runner-recorded initial Skill-body exposure. Scoring does not use the condition label.

Skill **timing**:
- reuse / no-terminal skill arm: append `SKILL.md` at process start (no-terminal cannot npx)
- cold-start skill arm only: expose the Skill body after the canonical mock `npx_skills_add`
- no-skill arm: never expose the body (install may still be recorded)

Pinned: Pi **0.84.4**, `openai-codex` / `gpt-5.6-luna`, thinking `low`. No fallback.

See [last-run-summary.md](last-run-summary.md) for the reviewed R1 inputs, results, and limits. Reproducing R1 requires those source revisions; using other files measures a new candidate.

```sh
node --test eval/agent-quickstart/grade-checks.mjs

# Set these to clean local checkouts and a fresh output directory.
AISA_TEST_DOCS=/path/to/docs/agent-quickstart.mdx
AISA_TEST_SKILL=/path/to/agent-skills/search-research/aisa/SKILL.md
AISA_TEST_CLI_SOURCE=/path/to/cli-runtime-checkout
AISA_TEST_PACK_OUT=/tmp/aisa-quickstart-pack
AISA_TEST_OUT=/tmp/aisa-quickstart-run

# Archive, build, pack and install the exact CLI commit into a temporary prefix.
# For R1, the CLI checkout must be at 19cc8bd52850c78fa57e8dc80a767f4bdfb796e1.
node eval/cli-guidance/run.mjs --self-check --suite candidate \
  --src "$AISA_TEST_CLI_SOURCE" \
  --expect-sha 19cc8bd52850c78fa57e8dc80a767f4bdfb796e1 \
  --out "$AISA_TEST_PACK_OUT"

node eval/agent-quickstart/run.mjs --self-check \
  --docs "$AISA_TEST_DOCS" \
  --docs-sha f0dbd7b3c6da817b1898b606c361dea850ea436741fa177e3f755d42d12dd6f3 \
  --skill "$AISA_TEST_SKILL" \
  --skill-sha 0acf5178ed10fbfb8396ecc7ceb8849603d3c8458590d516fada5785699727ef \
  --install-meta "$AISA_TEST_PACK_OUT/install/candidate/install-meta.json" \
  --out "$AISA_TEST_OUT-self"
```

After review clearance (recompute docs/skill sha256 if those files change):

```sh
AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs \
  --docs "$AISA_TEST_DOCS" \
  --docs-sha f0dbd7b3c6da817b1898b606c361dea850ea436741fa177e3f755d42d12dd6f3 \
  --skill "$AISA_TEST_SKILL" \
  --skill-sha 0acf5178ed10fbfb8396ecc7ceb8849603d3c8458590d516fada5785699727ef \
  --install-meta "$AISA_TEST_PACK_OUT/install/candidate/install-meta.json" \
  --out "$AISA_TEST_OUT"
```

`AISA_EVAL_SCORE_CLEARED=1` is a local review guard, not user authentication.

Same rubric both conditions. Grades use tool/HTTP ledgers and the required user-facing outcome. Wrong/unresolved provider or model exits 2; any failed task or safety check exits 1.
