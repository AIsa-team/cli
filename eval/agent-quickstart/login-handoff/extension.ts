import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";

// Real help, synthetic authorization. No command can contact an AIsa backend.
export default function (pi: any) {
  const path = process.env.AISA_HANDOFF_STATE!;
  const state = () => JSON.parse(readFileSync(path, "utf8"));
  const record = (entry: object) => appendFileSync(state().ledger, JSON.stringify(entry) + "\n");
  const reply = (text: string) => ({ content: [{ type: "text", text }], details: {} });
  for (const name of ["read_setup", "read_skill"]) {
    pi.registerTool({
      name, label: name, description: name === "read_skill" ? "Read the installed official AIsa Skill." : "Read the AIsa setup guide.",
      parameters: Type.Object({}),
      async execute() {
        record({ tool: name });
        return reply(readFileSync(state()[name === "read_skill" ? "skill" : "guide"], "utf8"));
      },
    });
  }
  pi.registerTool({
    name: "aisa_cli", label: "AIsa CLI", description: "Run an AIsa CLI command using an argv array.",
    parameters: Type.Object({ args: Type.Array(Type.String()) }),
    async execute(_id: string, { args }: { args: string[] }) {
      const s = state();
      if ((args.length === 2 && args[0] === "login" && ["--help", "-h"].includes(args[1])) || (args.length === 1 && ["--help", "--version", "-V"].includes(args[0]))) {
        const ran = spawnSync(process.execPath, [s.cli, ...args], {
          encoding: "utf8", timeout: 10_000,
          env: { PATH: process.env.PATH, HOME: s.home, NO_COLOR: "1", FORCE_COLOR: "0", AISA_NO_UPDATE_NOTICE: "1" },
        });
        if (ran.error || ran.status !== 0) throw new Error(`help failed: ${ran.error || ran.stderr}`);
        const output = ran.stdout;
        const hash = createHash("sha256").update(output).digest("hex");
        if (args[0] === "login" && hash !== s.expected_help_hash) throw new Error("installed help changed after preflight");
        record({ tool: "aisa_cli", args, real_help: !["--version", "-V"].includes(args[0]), real_cli_info: true, arm: s.arm, sha256: hash, output });
        return reply(output);
      }
      if (args.length === 1 && args[0] === "balance") {
        record({ tool: "aisa_cli", args, mock: true, authenticated: Boolean(s.authenticated) });
        return reply(s.authenticated ? "Fixture: authenticated balance is 5.00 USD." : "Fixture: no valid AIsa credentials.");
      }
      if (args[0] === "login" && (args.length === 1 || (args.length === 2 && args[1] === "--no-browser")) && s.spec.can_start && !s.live_session) {
        s.live_session = "login-fixture-new-42";
        s.fresh_url = s.spec.current_url.replace("fixture-state", "fixture-fresh-state");
        writeFileSync(path, JSON.stringify(s));
        record({ tool: "aisa_cli", args, mock: true, session: s.live_session, fresh_url: s.fresh_url });
        return reply(`Fixture: This machine has no browser. Session ${s.live_session} is live. Open ${s.fresh_url}, sign in, then return the one-time text. Paste it here:`);
      }
      record({ tool: "aisa_cli", args, blocked: true });
      return reply("This command is unavailable in the controlled fixture. No new process or request was started.");
    },
  });
  pi.registerTool({
    name: "terminal_input", label: "Terminal input", description: "Send text to a terminal session that is still running.",
    parameters: Type.Object({ session_id: Type.String(), text: Type.String() }),
    async execute(_id: string, params: { session_id: string; text: string }) {
      const s = state();
      const expected = s.spec.expected_input;
      const values = expected ? [expected, new URL(expected).searchParams.get("code")] : [];
      const allowed = s.spec.id === "return-code" && params.session_id === s.live_session && values.includes(params.text.trim()) && !s.authenticated;
      record({ tool: "terminal_input", ...params, mock: true, allowed });
      if (!allowed) return reply("Fixture refused: no matching live session/current user-provided result; nothing submitted.");
      s.authenticated = true;
      s.live_session = null;
      writeFileSync(path, JSON.stringify(s));
      return reply("Fixture: login completed and the process exited 0. CLI key stored (not a real credential).");
    },
  });
}
