#!/usr/bin/env python3
"""Opt-in, five fixed login handoffs: real CLI help, synthetic auth/terminal state."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import tarfile
import time

HERE = Path(__file__).resolve().parent
SYSTEM = "Use the installed official AIsa Skill to continue this setup. Read the available setup/Skill resources as needed. Use tools for actions; do not fabricate results. Keep the final response under 180 words."


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def public_event(value):
    if isinstance(value, dict):
        if value.get("type") in ["thinking", "thinking_start", "thinking_delta", "thinking_end"]:
            return None
        return {k: clean for k, v in value.items() if k != "thinkingSignature" and (clean := public_event(v)) is not None}
    if isinstance(value, list):
        return [clean for item in value if (clean := public_event(item)) is not None]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--self-check", action="store_true")
    for name in ["install-meta", "guide", "skill", "out"]:
        parser.add_argument("--" + name, type=Path)
    args = parser.parse_args()
    if not args.run and not args.self_check:
        print("SKIP: model execution is opt-in (--run); --self-check makes no model request.")
        return
    if args.run and os.environ.get("AISA_EVAL_SCORE_CLEARED") != "1":
        parser.error("run the independent preflight, then set AISA_EVAL_SCORE_CLEARED=1")
    if not all([args.install_meta, args.guide, args.skill, args.out]):
        parser.error("--install-meta, --guide, --skill and --out are required")
    args.out.mkdir(parents=True, exist_ok=True)
    args.out = args.out.resolve()
    if (args.out / "manifest.json").exists():
        parser.error("use a fresh output directory; prior observations are immutable")
    sources = {name: getattr(args, name).resolve() for name in ["guide", "skill"]}
    installs = json.loads(args.install_meta.read_text())
    baseline = HERE / "baseline-login-help.txt"
    cases = json.loads((HERE / "cases.json").read_text())
    assert len(cases) == 5
    pi_bin = Path(shutil.which("pi") or "").resolve()
    assert subprocess.check_output([str(pi_bin), "--version"], text=True).strip() == "0.84.4"
    home = args.out / "self-check-home"
    home.mkdir()
    cli_env = {"PATH": os.environ["PATH"], "HOME": str(home), "NO_COLOR": "1", "FORCE_COLOR": "0", "AISA_NO_UPDATE_NOTICE": "1"}
    help_hashes = {}
    for arm in ["full", "ablated"]:
        installed = installs[arm]
        assert digest(Path(installed["tarball"])) == installed["tarball_sha256"]
        assert digest(Path(installed["cli"])) == installed["cli_sha256"]
        entry = Path(installed["cli"]).resolve()
        assert entry.is_relative_to(Path(installed["install_prefix"]).resolve())
        package_path = entry.parent.parent / "package.json"
        package = json.loads(package_path.read_text())
        assert package["name"] == "@aisa-one/cli" and package["version"] == installed["version"]
        with tarfile.open(installed["tarball"]) as packed:
            assert packed.extractfile("package/dist/index.js").read() == entry.read_bytes()
            assert packed.extractfile("package/package.json").read() == package_path.read_bytes()
        assert digest(Path(installed["source_archive"])) == installed["source_archive_sha256"]
        help_text = subprocess.check_output(["node", installed["cli"], "login", "--help"], env=cli_env, text=True, timeout=10)
        assert help_text.startswith(baseline.read_text().rstrip()), "ablation must remove appended help detail only"
        assert (help_text == baseline.read_text()) == (arm == "ablated")
        if arm == "full":
            for marker in ["persistent interactive TTY", "same", "done", "https://tools.aisa.one/mcp", "balance"]:
                assert marker.lower() in help_text.lower(), marker
        help_hashes[arm] = hashlib.sha256(help_text.encode()).hexdigest()
        (args.out / (arm + "-help.txt")).write_text(help_text)
    patch = installs["ablation_patch"]
    assert hashlib.sha256(patch.encode()).hexdigest() == installs["ablation_patch_sha256"]
    removed = [line[1:] for line in patch.splitlines() if line.startswith("-") and not line.startswith("---")]
    added = [line for line in patch.splitlines() if line.startswith("+") and not line.startswith("+++")]
    assert removed == ['  .addHelpText("after", loginHelpAfter())'] and not added
    assert installs["full"]["source_commit"] == installs["ablated"]["source_commit"] == installs["source_commit"]
    frozen = {}
    for name, path in sources.items():
        frozen[name] = str(args.out / (name + ".md"))
        Path(frozen[name]).write_bytes(path.read_bytes())
    inputs = args.out / "inputs"
    inputs.mkdir()
    for name in ["run.py", "extension.ts", "adapter-check.mjs", "cases.json", "rubric.json", "baseline-login-help.txt"]:
        shutil.copyfile(HERE / name, inputs / name)
    shutil.copyfile(args.install_meta, inputs / "install-meta.json")
    manifest = {"source_sha256": {name: digest(path) for name, path in sources.items()},
                "cases_sha256": digest(HERE / "cases.json"), "extension_sha256": digest(HERE / "extension.ts"),
                "runner_sha256": digest(Path(__file__)), "baseline_sha256": digest(baseline),
                "rubric_sha256": digest(HERE / "rubric.json"), "help_sha256": help_hashes, "install_meta": installs, "system_prompt": SYSTEM,
                "pi_binary": {"path": str(pi_bin), "sha256": digest(pi_bin)}, "review_cleared": os.environ.get("AISA_EVAL_SCORE_CLEARED") == "1",
                "runtime": {"pi": "0.84.4", "provider": "openai-codex", "model": "gpt-5.6-luna", "thinking": "low"},
                "scope": "real compiled help retrieval; all auth, PTY and balance actions are synthetic"}
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    subprocess.run(["node", str(HERE / "adapter-check.mjs"), str(args.out), str(pi_bin)], check=True, timeout=30)
    if args.self_check:
        print("PASS: fixed sources and real help prefix checked; no model/auth call")
        return
    auth = json.loads((Path.home() / ".pi/agent/auth.json").read_text())
    selected_auth = {"openai-codex": auth["openai-codex"]}

    def run(job):
        arm, spec = job
        folder = args.out / (arm + "-" + spec["id"])
        folder.mkdir()
        pi_home = folder / "pi"
        pi_home.mkdir()
        auth_path = pi_home / "auth.json"
        auth_path.write_text(json.dumps(selected_auth))
        auth_path.chmod(0o600)
        (pi_home / "settings.json").write_text("{}")
        state = dict(frozen, arm=arm, spec=spec, home=str(folder), cli=installs[arm]["cli"], expected_help_hash=help_hashes[arm],
                     live_session=spec["live_session"], ledger=str(folder / "tools.jsonl"))
        state_path = folder / "state.json"
        state_path.write_text(json.dumps(state))
        env = {k: v for k, v in os.environ.items() if k in ["PATH", "LANG", "TMPDIR", "NODE_EXTRA_CA_CERTS", "NODE_USE_ENV_PROXY"] or "proxy" in k.lower()}
        env.update(HOME=str(folder), PI_CODING_AGENT_DIR=str(pi_home), PI_OFFLINE="1", PI_TELEMETRY="0", AISA_HANDOFF_STATE=str(state_path))
        prompt = "User request: " + spec["request"] + "\n\nObserved state:\n" + spec["observations"]
        command = [str(pi_bin), "--provider", "openai-codex", "--model", "gpt-5.6-luna", "--thinking", "low", "--no-builtin-tools", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session", "--extension", str(inputs / "extension.ts"), "--tools", "read_setup,read_skill,aisa_cli,terminal_input", "--mode", "json", "--print", "--system-prompt", SYSTEM, prompt]
        started = time.monotonic()
        proc = subprocess.Popen(command, cwd=folder, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            raw, stderr = proc.communicate(timeout=120)
            code = proc.returncode
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                raw, stderr = proc.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                raw, stderr = proc.communicate()
            code = 124
        (folder / "stderr.log").write_text(stderr)
        messages = []
        events = []
        for line in raw.splitlines():
            try:
                event = public_event(json.loads(line))
            except ValueError:
                continue
            if event is None:
                continue
            events.append(event)
            if event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant":
                messages.append(event["message"])
        (folder / "events.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
        last = messages[-1] if messages else {}
        ledger = [json.loads(line) for line in Path(state["ledger"]).read_text().splitlines()] if Path(state["ledger"]).exists() else []
        response = "\n".join(part.get("text", "") for part in last.get("content", []) if part.get("type") == "text")
        help_index = next((i for i, row in enumerate(ledger) if row.get("real_help") and row.get("args", [None])[0] == "login"), -1)
        skill_index = next((i for i, row in enumerate(ledger) if row["tool"] == "read_skill"), -1)
        mutations = [i for i, row in enumerate(ledger) if row["tool"] == "terminal_input" or (row.get("args", [None])[0] == "login" and not row.get("real_help"))]
        write_index = next((i for i, row in enumerate(ledger) if row.get("allowed") is True), -1)
        balance_index = next((i for i, row in enumerate(ledger) if row.get("args") == ["balance"] and row.get("authenticated")), -1)
        checks = {"read_skill": any(row["tool"] == "read_skill" for row in ledger),
                  "read_real_login_help": help_index >= 0,
                  "skill_help_action_order": 0 <= skill_index < help_index and all(help_index < i for i in mutations),
                  "no_blocked_action": not any(row.get("blocked") or row.get("allowed") is False for row in ledger),
                  "input_count": sum(row["tool"] == "terminal_input" for row in ledger) == (1 if spec["id"] == "return-code" else 0),
                  "relay_then_balance": spec["id"] != "return-code" or 0 <= help_index < write_index < balance_index,
                  "model_identity": last.get("model") == "gpt-5.6-luna" and last.get("provider") == "openai-codex",
                  "completed_response": code == 0 and last.get("stopReason") == "stop" and bool(response)}
        row = {"arm": arm, "case": spec["id"], "seconds": round(time.monotonic() - started, 3), "exit_code": code,
               "checks": checks, "response": response, "tools": ledger, "usage": [m.get("usage") for m in messages],
               "observed_model": last.get("model"), "semantic_grade": "independent review required; mechanical checks alone are not a pass"}
        (folder / "result.json").write_text(json.dumps(row, indent=2) + "\n")
        print(json.dumps({"arm": arm, "case": spec["id"], "checks": checks}), flush=True)
        return row

    jobs = [(arm, spec) for spec in cases for arm in ["full", "ablated"]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows = list(pool.map(run, jobs))
    for installed in installs.values():
        if isinstance(installed, dict) and "cli" in installed:
            assert digest(Path(installed["cli"])) == installed["cli_sha256"], "CLI changed during execution"
            assert digest(Path(installed["tarball"])) == installed["tarball_sha256"]
            assert digest(Path(installed["source_archive"])) == installed["source_archive_sha256"]
    (args.out / "results.json").write_text(json.dumps(rows, indent=2) + "\n")


if __name__ == "__main__":
    main()
