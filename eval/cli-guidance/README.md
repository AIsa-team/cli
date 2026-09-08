# CLI guidance Agent eval (default off)

Real Pi + real compiled/installed CLI. Router HTTP is a local stub. Fixtures are synthetic (`eval_fxtr_issuer_snapshot`, `eval_fxtr_scratch_note`) and distinct from the hardcoded help example `get_financial_company_facts`.

This suite is opt-in. It is not part of `npm test` or CI.

## Runtime (no silent fallback)

- Pi 0.84.4
- `--provider openai-codex --model gpt-5.6-luna --thinking low`
- Record the resolved provider/model from the JSONL stream
- If the resolved model is not `gpt-5.6-luna`, the runner refuses and does not score another model
- `gradeCase` receives `runtime={exit_code,signal,timed_out,parse_errors,transport_errors}`
- JSONL parse errors are kept (raw line + count). They are not dropped.
- Only a terminal successful Pi completion with nonempty final text is graded as final

## Freeze contract

`grade.mjs` and standalone `grade-checks.mjs` are integrated (`6ba095d`, `975f1aa`). Do not overwrite them. Do not add `*.test.mjs` (Vitest would collect `node:test`). Freeze the runtime files once, then wait for independent review before any scored 8+16.

`HASH_FILES` (hashes.json is the lockfile and is excluded):

- `cases.json`
- `system-prompt.txt`
- `grade.mjs`
- `grade-checks.mjs`
- `stub.mjs`
- `extension.ts`
- `run.mjs`

`run.mjs` is bound because model/tool limits, process env, and event parsing change scoring.

Every report records **CLI source SHA** and **eval commit + bundle**.

## Freeze, then run baseline first (only after reviewer clearance)

```bash
# After independent review + root authorization only:
AISA_EVAL_SCORE_CLEARED=1 node eval/cli-guidance/run.mjs \
  --suite baseline \
  --src /tmp/aisa-cli-eval-baseline \
  --expect-sha ec29516f41702aac6f5e26e98e53c2545c600840 \
  --out /tmp/aisa-cli-guidance-eval

AISA_EVAL_SCORE_CLEARED=1 node eval/cli-guidance/run.mjs \
  --suite candidate \
  --src /Users/eddiearc/repo/worktrees/aisa-cli-guidance-help \
  --expect-sha 3f12d666bc7e2a20efd6e8d806969288fd2284b8 \
  --concurrency 2 \
  --out /tmp/aisa-cli-guidance-eval
```

Rebuilt baseline must use the detached source `/tmp/aisa-cli-eval-baseline` @ `ec29516`. Alignment PR HEAD is now `3f12d66`; `--src` alignment `--expect-sha ec29516` fails closed.

`--self-check` packs/installs, runs `stub-checks.mjs` (whole-batch quote/use 400 + NOTE schema), and probes the isolated CLI against the stub without calling the model. `--model-preflight` is a non-scoring Luna completion that requires a nonempty successful final.

Reports stay under `--out` (not git). Traces include CLI/HTTP ledgers; do not commit raw Pi sessions or credentials.

## Thresholds

- Baseline: 1 run × 8 cases
- Candidate: 2 runs × 8 cases, concurrency ≤ 2
- Candidate pass: ≥14/16 task passes, every case ≥1 pass, 100% safety
- Compare baseline vs candidate as an observed sample only
