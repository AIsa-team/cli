# Agent briefing

You are being evaluated on completing a task with the `aisa plan` CLI. Work
from the current directory (the CLI repo root).

Rules:

- Invoke the CLI as: `node dist/index.js plan <subcommand> ...`
- Plans are stored under the directory in the `AISA_PLAN_DIR` environment
  variable (already set). Do not change it.
- Use only `plan` subcommands: `create`, `discover`, `add`, `item-replace`,
  `item-remove`, `set-budget`, `check`, `quote`, `show`, `list`.
- Prefer `--json` output and read it instead of guessing.
- Exit codes: 0 = ok, 2 = quote over budget, 3 = validation failed or quote
  blocked (missing scope, missing spend cap, etc.), 1 = other errors.
- Discover capabilities and their scope fields with:
  `node dist/index.js plan discover <query>` and validate with
  `node dist/index.js plan check <plan_id>`.
- Do not run `npm`, do not edit any files, do not use the network.
- The task is done when the plan's latest quote matches the GOAL below.
  The grader inspects the plan file on disk, not your words.
