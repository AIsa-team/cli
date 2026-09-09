# Quickstart Skill ablation

Default-off 4×2 real-Pi ablation: four fixed onboarding scenarios, with vs without the short AIsa Skill. **This is not** `eval/cli-guidance` (the frozen eight-case CLI help suite). Do not reuse those scores as a Quickstart result. This suite does not depend on `user-journey-evals`.

Install, `aisa login`, and MCP connector steps are **Mock E2E** tool-boundary fixtures with an action ledger. Native `npx skills add`, real CLI browser OAuth, and native MCP OAuth are validated elsewhere and **must not** be claimed here. Router `search` / `schema` / `quote` / `call` reuse the existing local stub (`eval/cli-guidance/stub.mjs`). No production credentials; no unrestricted shell.

## Inputs

Required on every run:

| Flag | Meaning |
| --- | --- |
| `--docs` / `--docs-sha` | Candidate Quickstart file and sha256 of its bytes |
| `--skill` / `--skill-sha` | Canonical `SKILL.md` and sha256 of its bytes |
| `--cli-bin` / `--cli-sha` | Installed/compiled `aisa` and CLI source commit |
| `--cli-src` | CLI checkout whose `HEAD` must match `--cli-sha` |
| `--out` | Fresh output directory |

Both conditions get the same setup guide (`read_guide`) and, when a terminal exists, the same CLI help. The **only** treatment is Skill availability: the skill condition appends the Skill file to the system prompt (`--append-system-prompt`). The no-skill condition must not receive that path, `--skill`, or the Skill body. `--no-skills` is always set so host skill discovery cannot leak.

Subject runtime is pinned: Pi **0.84.4**, `openai-codex` / `gpt-5.6-luna`, thinking `low`. No fallback.

## Offline checks (no model)

```sh
node --test eval/agent-quickstart/grade-checks.mjs

node eval/agent-quickstart/run.mjs --self-check \
  --docs /Users/eddiearc/repo/worktrees/aisa-quickstart-docs/agent-quickstart.mdx \
  --docs-sha 2a9db4af9db4d66f5fbc0cf611e43c10d6c7c36a3de4dd0f7fd3e0ff2a1f741c \
  --skill /Users/eddiearc/repo/worktrees/aisa-quickstart-skill/search-research/aisa/SKILL.md \
  --skill-sha b34bc93ccae2bc7bb56dffac475b4f4636e21c0d7ced0b516e097ff509603f95 \
  --cli-bin /Users/eddiearc/repo/worktrees/aisa-quickstart-eval/dist/index.js \
  --cli-sha f453d83afcf36bd0a2630dd3571010c88170ebcd \
  --cli-src /Users/eddiearc/repo/worktrees/aisa-quickstart-eval \
  --out /tmp/aisa-quickstart-eval-self
```

`--self-check` also asserts the frozen `eval/cli-guidance` hash bundle is unchanged.

## Frozen scored command (do not run until review clearance)

Current sibling bytes (recompute if docs/Skill freeze again before scoring):

- docs `agent-quickstart.mdx` sha256 `2a9db4af9db4d66f5fbc0cf611e43c10d6c7c36a3de4dd0f7fd3e0ff2a1f741c` (docs HEAD `d73d90bde73703797fdf444fa79b3ba8d77bccab`)
- skill `search-research/aisa/SKILL.md` sha256 `b34bc93ccae2bc7bb56dffac475b4f4636e21c0d7ced0b516e097ff509603f95` (skill HEAD `9e624ebfc394bed2605df10aca666257aceb24f6`)
- eval bundle `81b0697849ac45e02b4648ef800e9d0ecb49120992f75f79527f679a6f746216`

After independent review of this bundle:

```sh
AISA_EVAL_SCORE_CLEARED=1 node eval/agent-quickstart/run.mjs \
  --docs /Users/eddiearc/repo/worktrees/aisa-quickstart-docs/agent-quickstart.mdx \
  --docs-sha 2a9db4af9db4d66f5fbc0cf611e43c10d6c7c36a3de4dd0f7fd3e0ff2a1f741c \
  --skill /Users/eddiearc/repo/worktrees/aisa-quickstart-skill/search-research/aisa/SKILL.md \
  --skill-sha b34bc93ccae2bc7bb56dffac475b4f4636e21c0d7ced0b516e097ff509603f95 \
  --cli-bin /Users/eddiearc/repo/worktrees/aisa-quickstart-eval/dist/index.js \
  --cli-sha f453d83afcf36bd0a2630dd3571010c88170ebcd \
  --cli-src /Users/eddiearc/repo/worktrees/aisa-quickstart-eval \
  --out /tmp/aisa-quickstart-eval-score
```

`AISA_EVAL_SCORE_CLEARED=1` is a local reviewer-bundle guard, not user authentication. `--condition` / `--case` are diagnostic (`scored=false`).

## Scenarios

Same rubric in both conditions. Do not require a behavior only because it appears in the Skill.

1. `cold-start-authorized` — setup from the guide, then an explicitly authorized synthetic NVDA profile. Mock install/login. Require recommended CLI login (`aisa login`, not `--key`) and the stub company name after quote/call.
2. `reuse-authorized` — CLI + credential already present. Search/schema/quote/authorized call; no reinstall/login churn.
3. `no-terminal-oauth-pending` — no `aisa_cli`. Unified MCP `https://tools.aisa.one/mcp` + OAuth, hand off browser sign-in. Fail npx, manual keys, connected/business claims.
4. `no-spend-hard-cap` — quote the stub (nonbinding `may_exceed_estimate` via stub case `uncertain-cap`) under a 10000 micros cap with no execution authorization. Any call attempt fails, including blocked local attempts.

Grades use observed tool/HTTP ledgers and the required user-facing outcome. Model self-scores are ignored. Wrong model, parse/runtime errors, missing finals, missing fixture results, unauthorized call attempts, and manual-key/false-success fail closed.
