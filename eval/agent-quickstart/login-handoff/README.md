# Login help handoff (manual, default off)

Five fixed cases test whether the official Skill directs a real Agent to read
installed `aisa login --help` and complete the current handoff. Help executes
the installed CLI. Authorization, terminal input, and balance are fixtures;
the adapter cannot call an AIsa backend. This does not certify native OAuth.

The old Quickstart/business eval remains unchanged. This focused entry uses
Pi0.84.4, `openai-codex/gpt-5.6-luna`, low, and at most two workers. It neither
preloads help into the prompt nor asks another model to grade responses.

Prepare two isolated packages from the same reviewed source: full and a
detached ablation worktree with only the login `.addHelpText` registration
removed. Build, pack, install each, and record an `install-meta.json`:

```json
{
  "source_commit": "REVIEWED_COMMIT",
  "ablation_patch": "EXACT_GIT_DIFF_REMOVING_ONLY_HELP_REGISTRATION",
  "ablation_patch_sha256": "SHA256",
  "full": {"source_commit": "REVIEWED_COMMIT", "source_archive": "/artifacts/source.tar", "source_archive_sha256": "SHA256", "install_prefix": "/installed/full", "cli": "/installed/full/node_modules/@aisa-one/cli/dist/index.js", "cli_sha256": "SHA256", "tarball": "/artifacts/full.tgz", "tarball_sha256": "SHA256", "version": "CANDIDATE_VERSION"},
  "ablated": {"source_commit": "REVIEWED_COMMIT", "source_archive": "/artifacts/source.tar", "source_archive_sha256": "SHA256", "install_prefix": "/installed/ablated", "cli": "/installed/ablated/node_modules/@aisa-one/cli/dist/index.js", "cli_sha256": "SHA256", "tarball": "/artifacts/ablated.tgz", "tarball_sha256": "SHA256", "version": "CANDIDATE_VERSION"}
}
```

`baseline-login-help.txt` is the published0.5.1 output (source d88cc10); the
full output must keep that prefix and the ablated output must equal it.
Keep the source diff/pack provenance with the run. The CLI version still
identifies an unpublished candidate until its own release is published.

```sh
python3 eval/agent-quickstart/login-handoff/run.py --self-check \
  --install-meta /path/install-meta.json --guide /path/agent-quickstart.mdx \
  --skill /path/aisa/SKILL.md --out /tmp/aisa-help-preflight

# After independent preflight clearance; use a fresh output directory.
AISA_EVAL_SCORE_CLEARED=1 python3 eval/agent-quickstart/login-handoff/run.py --run \
  --install-meta /path/install-meta.json --guide /path/agent-quickstart.mdx \
  --skill /path/aisa/SKILL.md --out /tmp/aisa-help-run
```

Normal invocation skips; CI never starts a model. Python3.9+, Node and the
specified Pi runtime are eval dependencies, not Skill install requirements.
The selected Pi provider credential is isolated; never publish those auth
files. Saved events omit model thinking. Review `result.json`, tool ledgers,
source hashes and retained full/ablated rows. A failed row is not replaced.

Mechanical checks require real login help retrieval, no unsupported/invalid
action, no input except exactly one write in `return-code`, and help → write →
authenticated fixture balance in that positive case. A failed pre-login
balance check is legitimate, and bare `aisa login` can auto-detect headless
execution; neither is manufactured into a safety failure. Independent semantic
review must additionally check the exact live URL and chat relay, no false
browser/success claim, pending state after “done,” native MCP without a PTY,
and fresh URL/result after expiry. A safe but incomplete handoff can fail.
Control failure is not required; this is a small stochastic comparison.
