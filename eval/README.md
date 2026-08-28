# Plan CLI evaluation harness

Measures whether an agent, given a plain-language user goal, can drive the
`aisa plan` CLI to a correct, machine-verifiable outcome.

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
plan version), budget, per-item scope, estimates and spend caps. It never
reads the agent transcript and never uses an LLM judge. The plan file *is*
the contract, so "did the agent succeed" is a schema check, not an opinion.

## Usage

```bash
npm run build            # the harness exposes the package as `aisa` in each eval sandbox

# Validate the harness itself (no LLM): replay each scenario's
# known-good command sequence.
npm run eval             # = node eval/run.mjs (scripted agent)

# Run the weak-model baseline (requires pi and a DeepSeek API key;
# check readiness with: pi auth check)
node eval/run.mjs --agent pi-deepseek

# Options
node eval/run.mjs --scenario s1_traffic_quote   # one scenario
node eval/run.mjs --keep                        # keep temp plan dirs + transcripts
node eval/run.mjs --report /tmp/eval.json       # write JSON report
node eval/run.mjs --agent pi-deepseek --model deepseek-chat   # model override
EVAL_VERBOSE=1 node eval/run.mjs                # print passing checks too
```

Exit code is 0 only if every scenario passes.

## Scenarios

| id | what it proves |
|---|---|
| `s1_traffic_quote` | capability discovery + typed scope + exact-formula quote within budget |
| `s2_budget_negotiation` | reacting to exit code 2 by shrinking scope until the quote is ready |
| `s3_unverified_pricing_cap` | unverified pricing requires an explicit `--max-credits` spend cap |
| `s4_jordan_capability_fit` | capability fit: compile one complete canonical scope (domain/country/month/granularity/metric) instead of blind API trial; exactly one item, max 1 credit |
| `s4_jordan_capability_fit` | capability-fit-before-cost: derive the one complete US/monthly scope before any paid Similarweb call |

## Adding a scenario

Drop a JSON file into `eval/scenarios/`:

- `goal` — the user-style objective handed to the agent verbatim.
- `expect` — assertions for the grader: `quote_status`, `budget_credits`,
  `totals_within_budget`, `totals_max_credits_lte`, `items_count`
  (exact manifest size, for capability-fit scenarios), and `items[]` with
  `capability`, `scope_contains`, `estimate_credits` / `estimate_null`,
  `max_credits_set` / `max_credits_lte`.
- `scripted_reference` — a known-good command replay. It doubles as the
  harness self-test and as the human reference solution; steps may declare
  `expect_exit` (e.g. an intentional over-budget quote) and the first
  `create --json` step must declare `capture: "plan_id"`.

## Adding an agent

Drop a JSON file into `eval/agents/` with `argv_template` (placeholders:
`{prompt}`, `{provider}`, `{model}`), `provider`, `model`,
`timeout_seconds`. The prompt is `eval/agent-briefing.md` plus the scenario
goal. The agent's exit code is ignored — only the plan artifact counts.
