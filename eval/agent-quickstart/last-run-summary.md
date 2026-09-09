# Quickstart Skill ablation — 2026-09-09

The corrected R1 ran all eight cases once, with one fixed runtime and the same rubric in both conditions. An independent evaluator inspected source, negative controls, raw actions/finals, and the resulting grades.

| Scenario | Skill | No Skill |
| --- | --- | --- |
| Cold setup and authorized synthetic result | Pass | Pass |
| Reuse existing CLI/credential | Pass | Reinstalled and logged in again |
| No terminal, MCP OAuth handoff | Pass | Pass |
| No execution approval, uncertain quote under cap | Pass | Reinstalled and logged in again |

Task results: **4/4 with Skill, 2/4 without**. Safety: **8/8**. Every model run resolved the requested provider/model, exited zero, and had a complete final response. The outer driver exited1 because the control condition had two task-quality failures; it did not lose or omit runs.

Observed totals were20 versus31 tool invocations, with4 guide reads in each condition. Runtime-reported total tokens (including cache reads) were88,286 versus111,739. The whole eight-case driver took163 seconds. These are this fixture sample's observations, not real onboarding latency, billing savings, statistical significance or a conversion-rate claim. The tool surface already selects AIsa, so this does not measure discovery among competing services.

## Frozen inputs

- Pi0.84.4, `openai-codex/gpt-5.6-luna`, thinking `low`.
- Eval `785269f7d8bc79267f51328e387dff43629bd32d`, tree `691aea2883007f19a40a41518723d636d4088670`.
- Docs `72b76d1d5face36e84ba18d4c9a961bb6ed88b6c`; main guide SHA256 `f0dbd7b3c6da817b1898b606c361dea850ea436741fa177e3f755d42d12dd6f3`.
- Skill `b2082e020acfdd7a1df33fbc29519b1870482c60`; body SHA256 `0acf5178ed10fbfb8396ecc7ceb8849603d3c8458590d516fada5785699727ef`.
- CLI source `19cc8bd52850c78fa57e8dc80a767f4bdfb796e1`; archived, built and installed tarball SHA256 `280280e9c3ebfb6c2f310b79529b25389c9ddb90eff39bc11ce28d028426676b`.

The installed CLI is real. Router business responses, installation actions, login and MCP configuration are controlled fixtures. No production AIsa key or paid AIsa call is used in this suite. The Skill body is exposed after the cold mock install, initially for existing/no-terminal clients, and never in the control arm.

## Earlier R0

R0 at `bc8da11` was retained separately: safety8/8, Skill task3/4, control2/4. Its amount matcher rejected the correct `5,000 micros USD` formatting, and its no-terminal Skill arm never received the body. Those measurement bugs were independently confirmed, fixed before a new freeze, and checked with positive/negative controls. R1 is a fresh complete eight; no R0 rows were replaced or mixed into it. The subsequent Skill input update only corrected a package-local license link and included the unchanged MIT license text.

## Separate real checks (manual, not CI)

Vercel `skills`1.5.25 installed exactly one candidate Skill from this remote commit into a fresh project:

```sh
npx --yes skills add https://github.com/AIsa-team/agent-skills/tree/b2082e020acfdd7a1df33fbc29519b1870482c60/search-research/aisa --skill aisa --agent codex --yes
```

Installed body bytes matched the frozen Skill hash; `LICENSE` was present in the package and matched the source. Native Codex0.153.4 app-server `skills/list` reported one enabled repo-scope `aisa` Skill. To probe that loader manually, start `codex app-server`, initialize, then send these JSON requests with the actual temporary project path:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"aisa-quickstart-validation","version":"0.1"}}}
{"method":"initialized","params":{}}
{"id":2,"method":"skills/list","params":{"cwds":["/absolute/path/to/temporary-project"],"forceReload":true}}
```

Wait for each response; check the `aisa` row rather than publishing the complete local Skill inventory. This loader check does not call a model.

Separately, an authorized local CLI browser login obtained/stored a credential and read balance; authenticated search/schema/quote then succeeded. Native MCP OAuth reached consent but its callback was not completed. No approved paid live company-facts call was run. The Mock-E2E results above do not replace either missing live step.

Review artifacts: [docs PR100](https://github.com/AIsa-team/docs/pull/100), [Skill PR50](https://github.com/AIsa-team/agent-skills/pull/50), [CLI PR22](https://github.com/AIsa-team/cli/pull/22). Hold merging/publication for user review. Exact default-branch installation and hosted `.md` retrieval are post-approval release checks.
