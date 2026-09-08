# CLI guidance Agent eval (default off)

Real Pi + real compiled/installed CLI. Router HTTP is a local stub. Fixtures are synthetic (`eval_synth_*`), not live catalog names.

This suite is opt-in. It is not part of `npm test` or CI.

## Runtime (no silent fallback)

- Pi 0.84.4
- `--provider openai-codex --model gpt-5.6-luna --thinking low`
- Record the resolved provider/model from the JSONL stream
- If the resolved model is not `gpt-5.6-luna`, the runner refuses and does not score another model

## Freeze, then run baseline first

```bash
node eval/cli-guidance/run.mjs --freeze

node eval/cli-guidance/run.mjs \
  --suite baseline \
  --src /Users/eddiearc/repo/worktrees/aisa-cli-mcp-alignment \
  --expect-sha ec29516f41702aac6f5e26e98e53c2545c600840 \
  --out /tmp/aisa-cli-guidance-eval

# Candidate only after the help writer’s final commit
node eval/cli-guidance/run.mjs \
  --suite candidate \
  --src /Users/eddiearc/repo/worktrees/aisa-cli-guidance-help \
  --expect-sha <final-sha> \
  --concurrency 2 \
  --out /tmp/aisa-cli-guidance-eval
```

`--self-check` packs/installs and probes the isolated CLI against the stub without calling the model.

Reports stay under `--out` (not git). Traces include CLI/HTTP ledgers; do not commit raw Pi sessions or credentials.

## Thresholds

- Baseline: 1 run × 8 cases
- Candidate: 2 runs × 8 cases, concurrency ≤ 2
- Candidate pass: ≥14/16 task passes, every case ≥1 pass, 100% safety
- Compare baseline vs candidate as an observed sample only
