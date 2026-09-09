# Quickstart Skill ablation

Default-off Pi ablation of **Skill context** under a fixed Quickstart guide. Four cases × `--condition skill|no-skill`. Same rubric. **Not** `eval/cli-guidance`. Do not reuse those scores. This is not causal proof of docs optimization.

Install / `aisa login` / MCP are **Mock E2E**. Native npx, browser OAuth, and MCP OAuth are not claimed. Router `search`/`schema`/`quote`/`call` use the existing stub. No production AIsa credentials; no unrestricted shell.

Required flags: `--docs` `--docs-sha` `--skill` `--skill-sha` `--install-meta` `--out`. Optional: `--condition skill|no-skill`, `--case ID`.

`--install-meta` is `install-meta.json` from `eval/cli-guidance/run.mjs` archive/pack. Do not pass a free `--cli-bin`.

Pinned: Pi **0.84.4**, `openai-codex` / `gpt-5.6-luna`, thinking `low`.

See [last-run-summary.md](last-run-summary.md) for the frozen R2 inputs/results and the immutable historical R1 reference. Using different input revisions measures a new candidate.

```sh
node --test eval/agent-quickstart/grade-checks.mjs

# Pack the exact CLI commit once (R1 used 19cc8bd52850c78fa57e8dc80a767f4bdfb796e1).
node eval/cli-guidance/run.mjs --self-check --suite candidate \
  --src /path/to/cli --expect-sha 19cc8bd52850c78fa57e8dc80a767f4bdfb796e1 \
  --out /tmp/aisa-quickstart-pack

# Use the exact source revisions listed in last-run-summary.md for R2.
AISA_TEST_DOCS=/path/to/docs/agent-quickstart.mdx
AISA_TEST_SKILL_REPO=/path/to/agent-skills
AISA_TEST_OLD_SKILL=/tmp/aisa-old-SKILL.md
AISA_TEST_LEAN_SKILL="$AISA_TEST_SKILL_REPO/search-research/aisa/SKILL.md"
AISA_TEST_META=/tmp/aisa-quickstart-pack/install/candidate/install-meta.json
git -C "$AISA_TEST_SKILL_REPO" show 0fcff274b6522f57b85a0eaf0c6298781c7c17c5:search-research/aisa/SKILL.md > "$AISA_TEST_OLD_SKILL"
AISA_TEST_DOCS_SHA=$(shasum -a 256 "$AISA_TEST_DOCS" | cut -d ' ' -f1)
AISA_TEST_OLD_SHA=$(shasum -a 256 "$AISA_TEST_OLD_SKILL" | cut -d ' ' -f1)
AISA_TEST_LEAN_SHA=$(shasum -a 256 "$AISA_TEST_LEAN_SKILL" | cut -d ' ' -f1)

node eval/agent-quickstart/run.mjs --self-check \
  --docs "$AISA_TEST_DOCS" --docs-sha "$AISA_TEST_DOCS_SHA" \
  --skill "$AISA_TEST_OLD_SKILL" --skill-sha "$AISA_TEST_OLD_SHA" \
  --install-meta "$AISA_TEST_META" --out /tmp/aisa-qs-self
```

After independent clearance (12 runs = 4 cases × old Skill, lean Skill, no Skill):

```sh
AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs \
  --docs "$AISA_TEST_DOCS" --docs-sha "$AISA_TEST_DOCS_SHA" \
  --skill "$AISA_TEST_OLD_SKILL" --skill-sha "$AISA_TEST_OLD_SHA" \
  --install-meta "$AISA_TEST_META" --condition skill --out /tmp/aisa-qs-old-skill

AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs \
  --docs "$AISA_TEST_DOCS" --docs-sha "$AISA_TEST_DOCS_SHA" \
  --skill "$AISA_TEST_LEAN_SKILL" --skill-sha "$AISA_TEST_LEAN_SHA" \
  --install-meta "$AISA_TEST_META" --condition skill --out /tmp/aisa-qs-lean-skill

AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs \
  --docs "$AISA_TEST_DOCS" --docs-sha "$AISA_TEST_DOCS_SHA" \
  --skill "$AISA_TEST_LEAN_SKILL" --skill-sha "$AISA_TEST_LEAN_SHA" \
  --install-meta "$AISA_TEST_META" --condition no-skill --out /tmp/aisa-qs-no-skill
```

`--case ID` limits to one of `cold-start-authorized`, `reuse-authorized`, `no-terminal-oauth-pending`, `no-spend-hard-cap`.

`AISA_EVAL_SCORE_CLEARED=1` is a local review guard, not user authentication. Wrong/unresolved provider or model exits 2; any failed task or safety check exits 1.
