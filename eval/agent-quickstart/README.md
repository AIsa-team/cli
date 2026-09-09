# Quickstart Skill ablation

Default-off 4×2 Pi ablation: four onboarding scenarios, with vs without the short AIsa Skill. **Not** `eval/cli-guidance`. Do not reuse those scores.

Install / `aisa login` / MCP are **Mock E2E** fixtures. Native npx, browser OAuth, and MCP OAuth are not claimed here. `search` / `schema` / `quote` / `call` use the existing Router stub. No production credentials; no unrestricted shell.

Required flags: `--docs` `--docs-sha` `--skill` `--skill-sha` `--install-meta` `--out`.

`--install-meta` is the `install-meta.json` written by `eval/cli-guidance/run.mjs` archive/pack (sha, tarball SHA-256, installed bin). Do not pass a free `--cli-bin`.

Both conditions get the same setup guide and CLI help. Skill **timing**:
- reuse/already-installed skill arm: append `SKILL.md` at process start
- cold-start skill arm: expose the Skill body only after the canonical mock `npx_skills_add`
- no-skill arm: never expose the body (install may still be recorded)

Pinned: Pi **0.84.4**, `openai-codex` / `gpt-5.6-luna`, thinking `low`. No fallback.

```sh
node --test eval/agent-quickstart/grade-checks.mjs

node eval/agent-quickstart/run.mjs --self-check \
  --docs /Users/eddiearc/repo/worktrees/aisa-quickstart-docs/agent-quickstart.mdx \
  --docs-sha f0dbd7b3c6da817b1898b606c361dea850ea436741fa177e3f755d42d12dd6f3 \
  --skill /Users/eddiearc/repo/worktrees/aisa-quickstart-skill/search-research/aisa/SKILL.md \
  --skill-sha b34bc93ccae2bc7bb56dffac475b4f4636e21c0d7ced0b516e097ff509603f95 \
  --install-meta /tmp/aisa-quickstart-packed-final/install/candidate/install-meta.json \
  --out /tmp/aisa-quickstart-eval-self
```

After review clearance (recompute docs/skill sha256 if those files change):

```sh
AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs \
  --docs /Users/eddiearc/repo/worktrees/aisa-quickstart-docs/agent-quickstart.mdx \
  --docs-sha f0dbd7b3c6da817b1898b606c361dea850ea436741fa177e3f755d42d12dd6f3 \
  --skill /Users/eddiearc/repo/worktrees/aisa-quickstart-skill/search-research/aisa/SKILL.md \
  --skill-sha b34bc93ccae2bc7bb56dffac475b4f4636e21c0d7ced0b516e097ff509603f95 \
  --install-meta /tmp/aisa-quickstart-packed-final/install/candidate/install-meta.json \
  --out /tmp/aisa-quickstart-eval-score
```

`AISA_EVAL_SCORE_CLEARED=1` is a local review guard, not user authentication.

Same rubric both conditions. Grades use tool/HTTP ledgers and the required user-facing outcome. Wrong/unresolved provider or model exits 2; any failed task or safety check exits 1.
