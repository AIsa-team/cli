# Not scored

Rejected / C-c / fetch-failed / empty-final traffic is **diagnostic only**. Do not copy those pass counts into a baseline or candidate score.

- Archive: `/tmp/aisa-cli-guidance-eval/diagnostic-dbad73ce-not-scored`
- Pilot / model-preflight: `/tmp/aisa-cli-guidance-eval/pilot`
- Rejected freeze: `dbad73ce…` / eval `9e875ed`

Scored 8+16 starts only after independent review of this freeze, then root authorization. No model runs for this bundle yet.

Planned after prescore clear (do not launch until the parent gives the exact lean `--src`/`--expect-sha` and clearance):

1. Diagnostic `--repeats 1` on 4 cases, once each for the full and lean CLI variants (`--case`; `scored=false`).
2. Official scored baseline 8, then the chosen candidate 16.

Same frozen cases, grader, and model. Lean variant removes only duplicate root help/manifest policy; child help, guidance, and execution stay unchanged. Existing `--case` / `--repeats 1` is enough; no new eval API.

Next scored sources (not run yet):

- Baseline SHA: `ec29516f41702aac6f5e26e98e53c2545c600840` (`--src` is any checkout at that SHA)
- Full candidate SHA (unless parent replaces it): `3f12d666bc7e2a20efd6e8d806969288fd2284b8`
- Lean candidate SHA: wait for parent pin
