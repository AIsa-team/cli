# Plan CLI evaluation harness

Measures whether an agent, given a user request, can drive the `aisa plan`
CLI to a correct, machine-verifiable outcome.

The **task set and the grading standards live in one file**:
[`eval/suite.json`](suite.json). Edit that file to add or change scenarios;
export it to share or review.

This branch continues `codex/aisa-plan-eval-cli-command` (`aisa` on PATH)
and `codex/aisa-plan-natural-language-eval` (natural-language user goals).

## Why a weak model as the baseline

The default external agent is **pi + DeepSeek flash** — a cheap,
deliberately low-capability model. The harness treats it as a floor: if a
weak model can discover capabilities, respect exit codes, and land a ready
quote within budget, stronger models will almost certainly manage too. A
scenario that a weak model keeps failing usually points at CLI ergonomics
(unclear errors, missing hints), not at the model.

## No real AIsa API calls, ever

The eval is fully offline with respect to AIsa:

- Every `plan` subcommand it exercises is local-only — the capability
  registry is a code snapshot, quotes come from the local engine, and plans
  are written to a scenario-scoped temp `AISA_PLAN_DIR`. No network, no API
  key, no credits.
- The runner additionally overrides `AISA_API_KEY` with a poisoned sentinel
  in the child environment (env beats the `~/.aisa/key` file in the CLI's
  key resolution). Even if an LLM agent ignores its briefing and runs
  `aisa run` or another gateway command, the call fails auth — real spend is
  mechanically impossible, not just forbidden by instructions.

The only paid traffic an eval run generates is the evaluated model's own
inference (e.g. DeepSeek tokens via pi), which is the thing being measured.

## How grading works

Grading is **deterministic and artifact-based**: the grader reads the plan
JSON files produced under a scenario-scoped `AISA_PLAN_DIR` and asserts on
structured facts — quote status, quote freshness (quote matches the current
plan version), budget, per-item scope, estimates, spend caps, and forbidden
capabilities. It never reads the agent transcript and never uses an LLM
judge. The plan file *is* the contract.

Failed trials still write a transcript path so a human can tell a real agent
mistake from a broken task or grader. The grader itself does not use that
file.

## Suites and metrics

`suite.json` → `standards` is the scoring contract:

| suite | what it measures | agent pass rule |
|---|---|---|
| `regression` | CLI contract still works | `pass^k` (all trials) |
| `capability` | hill to climb: gaps, budget, overtrigger | `pass@k` (at least one) |
| `natural` | same hidden expect, plain user request | `pass@k` |

Scripted mode always uses 1 trial (`pass^1`). Agent mode defaults to 3
trials. Override with `--trials N`.

## Usage

```bash
npm run build            # the harness exposes the package as `aisa` in each eval sandbox

# Validate the harness itself (no LLM): replay each scenario's
# known-good command sequence.
npm run eval             # = node eval/run.mjs (scripted agent)

# List / export the suite (the config file is the source of truth)
node eval/run.mjs --list
node eval/run.mjs --export -                 # full suite JSON to stdout
node eval/run.mjs --export-summary           # markdown table
node eval/run.mjs --export /tmp/suite.json

# Run the weak-model baseline (requires pi and a DeepSeek API key;
# check readiness with: pi auth check)
node eval/run.mjs --agent pi-deepseek

# Run one named suite
node eval/run.mjs --suite regression
node eval/run.mjs --agent pi-deepseek --suite natural

# Options
node eval/run.mjs --scenario s1_traffic_quote   # one scenario
node eval/run.mjs --keep                        # keep temp plan dirs + transcripts
node eval/run.mjs --transcripts-dir /tmp/eval-tx
node eval/run.mjs --report /tmp/eval.json       # write JSON report
node eval/run.mjs --agent pi-deepseek --model deepseek-chat
node eval/run.mjs --trials 5
EVAL_VERBOSE=1 node eval/run.mjs                # print passing checks too
```

Exit code is 0 only if every selected scenario meets its pass rule.

## Adding a scenario

Edit `eval/suite.json` (do not add files under `eval/scenarios/`).

Each scenario needs:

- `id`, `suite` (`regression` | `capability` | `natural`), `title`
- `goal` — handed to the agent as the user message. Natural-suite goals
  must not name CLI commands, capability ids, or grader fields.
- `expect` — grader assertions: `quote_status`, `budget_credits`,
  `totals_within_budget`, `totals_max_credits_lte`, `items_count`,
  `forbidden_capabilities`, and `items[]` with `capability`,
  `scope_contains`, `estimate_credits` / `estimate_null`,
  `max_credits_set` / `max_credits_lte`.
- `scripted_reference` — known-good `aisa` command replay. The first
  `create --json` step must `capture: "plan_id"`. Steps may set
  `expect_exit` (e.g. over-budget quote = 2).

Then run `node eval/run.mjs --list` to confirm it loaded, and
`node eval/run.mjs --scenario <id>` to self-test the reference solution.

## Adding an agent

Drop a JSON file into `eval/agents/` with `argv_template` (placeholders:
`{prompt}`, `{provider}`, `{model}`), `provider`, `model`,
`timeout_seconds`. The prompt is `eval/agent-briefing.md` plus the scenario
goal as `## USER MESSAGE`. The agent's exit code is ignored — only the plan
artifact counts.
