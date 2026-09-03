import * as readline from "node:readline/promises";
import chalk from "chalk";
import {
  STEP_TITLES, STEP_AGENT, STEP_MODELS, STEP_CAPS, agentRank,
  AGENT_BADGE, AGENT_NOTES, t, fill, type Lang,
} from "./flow.js";
import type { ClientInfo, LlmMode, Selection } from "./connect-shared.js";
import { INSTALLERS } from "./install.js";

import type { LiveServer } from "./mcp.js";
import { httpFetch } from "../utils/http.js";

/** A client as the flow sees it: detection plus whether we could install it. */
export interface FlowClient extends ClientInfo {
  installable: boolean;
  command?: string;
}

/** Same rule the page applies, so both offer the same rows. */
export function flowClients(clients: ClientInfo[], canInstall: boolean): FlowClient[] {
  return clients.map((c) => ({
    ...c,
    installable: !c.detected && Boolean(INSTALLERS[c.id]) && canInstall,
    command: INSTALLERS[c.id]?.command,
  }));
}

/**
 * The connect flow, rendered in the terminal.
 *
 * Not a fallback for the page — the same flow, drawn differently. Every
 * question, option and sentence comes from flow.ts, which is also what the
 * page renders, so the two cannot describe the same choice in different
 * words. A menu numbered here matches the card order there because both sort
 * by `agentRank`.
 *
 * Two reasons this exists rather than "open the page":
 *
 *  · A machine with no browser. Linux without a desktop, an SSH session, a
 *    container — where printing a localhost URL is not an offer, it is a
 *    dead end.
 *  · A browser that did not work. The page failing to open used to end the
 *    run; now it drops through to here.
 *
 * ── Staying in step with the page ─────────────────────────────────────────
 * Both surfaces read and write one draft on the server (RunState.draft).
 * Answering here POSTs the choice, so a page open at the same time shows it;
 * between questions this polls, so a choice made in the page appears here.
 * Neither is the master.
 */

export interface TerminalFlowOptions {
  baseUrl: string;
  token: string;
  lang: Lang;
  servers: LiveServer[];
  clients: FlowClient[];
  /** Set when this is the only surface — no page was opened. */
  headless: boolean;
}

const dim = chalk.gray;
const bold = chalk.bold;

/** A framed step header, so the terminal has the page's sense of place. */
function header(n: number, lang: Lang): string {
  const step = STEP_TITLES.find((s) => s.n === n)!;
  const title = `${n}/6  ${t(step.title, lang)}`;
  return `\n${bold.cyan("┌─ " + title)} ${dim("· " + t(step.sub, lang))}`;
}

/** Strip the markup the page needs and the terminal cannot show. */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wrap to the terminal width, so a paragraph does not become one long line. */
export function wrap(text: string, width = Math.min(process.stdout.columns || 80, 84)): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    // CJK has no spaces, so a "word" can be a whole sentence — measure and
    // break it rather than emitting a line far past the width.
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = "";
    }
    if (word.length > width) {
      if (line) { out.push(line); line = ""; }
      for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width));
      continue;
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function say(text: string, indent = "│  "): void {
  for (const line of wrap(plain(text))) console.log(dim(indent) + line);
}

/**
 * Ask one question. Returns the chosen index, or -1 if the user just pressed
 * enter with no default and nothing to pick.
 *
 * `onPoll` runs between keystrokes-worth of time so a choice made in the page
 * can interrupt the prompt — the terminal is not allowed to sit on a question
 * the user already answered somewhere else.
 */
async function ask(
  rl: readline.Interface,
  prompt: string,
  count: number,
  fallback: number
): Promise<number> {
  for (;;) {
    const answer = (await rl.question(bold.cyan("│  > "))).trim();
    if (answer === "") return fallback;
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1;
    console.log(dim("│  ") + chalk.yellow(prompt));
  }
}

/** Push a change to the shared draft. Failure is not fatal: the terminal can
 *  still finish the run, it just stops mirroring into a page nobody may have
 *  open. */
async function push(
  o: TerminalFlowOptions,
  rev: number,
  patch: { step?: number; draft?: Partial<Selection> }
): Promise<{ rev: number; draft?: Selection }> {
  try {
    const res = await httpFetch(`${o.baseUrl}/select?token=${o.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev, ...patch }),
      timeoutMs: 5_000,
    });
    const body = (await res.json()) as { rev: number; draft?: Selection };
    return body;
  } catch {
    return { rev };
  }
}

/** Read the shared draft, to pick up whatever the page did. */
async function pull(o: TerminalFlowOptions): Promise<{ rev: number; draft?: Selection } | undefined> {
  try {
    const res = await httpFetch(`${o.baseUrl}/status?token=${o.token}`, {
      idempotent: true,
      maxAttempts: 1,
      timeoutMs: 3_000,
    });
    const s = (await res.json()) as { rev?: number; draft?: Selection };
    return { rev: s.rev ?? 0, draft: s.draft };
  } catch {
    return undefined;
  }
}

/**
 * Walk the flow in the terminal and return what was chosen.
 *
 * Returns undefined when the user abandons it, which the caller treats the
 * same way as closing the page.
 */
export async function runTerminalFlow(
  o: TerminalFlowOptions
): Promise<Selection | undefined> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let rev = 0;
  const draft: Selection = { servers: [], clients: [], install: [], llmMode: "backup" };

  // Start from whatever the shared draft already holds — a page may have been
  // open first, and its ticks are the starting point here rather than being
  // silently discarded.
  const seed = await pull(o);
  if (seed) {
    rev = seed.rev;
    if (seed.draft) Object.assign(draft, seed.draft);
  }

  try {
    // ── step 2: your agent ──
    console.log(header(2, o.lang));
    say(t(STEP_AGENT.question, o.lang));
    console.log(dim("│"));
    const shown = o.clients
      .filter((c) => c.detected || c.installable)
      .sort((a, b) => agentRank(a.id) - agentRank(b.id));
    if (shown.length === 0) return undefined;
    shown.forEach((c, i) => {
      const badge = c.detected
        ? chalk.green(t(AGENT_BADGE.detected, o.lang))
        : chalk.yellow(t(AGENT_BADGE.absent, o.lang));
      console.log(`${dim("│")}   ${bold(String(i + 1) + ")")} ${c.label.padEnd(16)} ${badge}  ${dim(c.detail ?? "")}`);
    });
    console.log(dim("│"));
    const preferred = Math.max(0, shown.findIndex((c) => draft.clients[0] === c.id));
    const pickedIdx = await ask(rl, `1–${shown.length}`, shown.length, preferred);
    const client = shown[pickedIdx];
    draft.clients = [client.id];
    draft.install = client.detected ? [] : [client.id];
    console.log(dim("└─ ") + chalk.green(client.label) + " ✓");
    if (AGENT_NOTES[client.id]) say(t(AGENT_NOTES[client.id], o.lang), "   ");
    ({ rev } = await push(o, rev, { step: 3, draft: { clients: draft.clients, install: draft.install } }));

    // ── step 3: models ──
    console.log(header(3, o.lang));
    say(`${t(STEP_MODELS.h2Prefix, o.lang)}${client.label}${t(STEP_MODELS.h2Suffix, o.lang)}`);
    console.log(dim("│"));
    const modes: Array<{ id: LlmMode; label: string; brief: string }> = client.detected
      ? [
          { id: "backup", label: t(STEP_MODELS.backup.name, o.lang), brief: "" },
          { id: "switch", label: t(STEP_MODELS.switchIt.name, o.lang), brief: plain(t(STEP_MODELS.switchIt.brief, o.lang)) },
          { id: "skip", label: t(STEP_MODELS.notNow.name, o.lang), brief: plain(t(STEP_MODELS.notNow.briefDetected, o.lang)) },
        ]
      : [
          { id: "switch", label: t(STEP_MODELS.freshSwitch.name, o.lang), brief: plain(t(STEP_MODELS.freshSwitch.brief, o.lang)) },
          { id: "skip", label: t(STEP_MODELS.notNow.name, o.lang), brief: plain(t(STEP_MODELS.notNow.briefFresh, o.lang)) },
        ];
    modes.forEach((m, i) => {
      const rec = i === 0 ? dim(` (${t(STEP_MODELS.recommended, o.lang)})`) : "";
      console.log(`${dim("│")}   ${bold(String(i + 1) + ")")} ${m.label}${rec}`);
      if (m.brief) for (const l of wrap(m.brief, 68)) console.log(dim("│      ") + dim(l));
    });
    console.log(dim("│"));
    const modeIdx = await ask(rl, `1–${modes.length}`, modes.length, 0);
    draft.llmMode = modes[modeIdx].id;
    console.log(dim("└─ ") + chalk.green(modes[modeIdx].label) + " ✓");
    ({ rev } = await push(o, rev, { step: 4, draft: { llmMode: draft.llmMode } }));

    // ── step 4: capabilities ──
    console.log(header(4, o.lang));
    const totalTools = o.servers.reduce((n, s) => n + s.toolCount, 0);
    const cats = [...new Set(o.servers.map((s) => s.category))];
    say(fill(STEP_CAPS.counts, o.lang, {
      areas: cats.length, servers: o.servers.length, tools: totalTools,
    }));
    console.log(dim("│"));
    // Pull once more: the capability list is long, and a page open beside
    // this one is the likelier place to have ticked through it.
    const fresh = await pull(o);
    if (fresh?.draft?.servers?.length) draft.servers = fresh.draft.servers;
    if (fresh) rev = fresh.rev;
    const chosen = new Set(draft.servers);
    o.servers.forEach((s, i) => {
      const mark = chosen.has(s.slug) ? chalk.green("[x]") : dim("[ ]");
      console.log(`${dim("│")}  ${mark} ${bold(String(i + 1).padStart(2))}) ${s.slug.padEnd(24)} ${dim(String(s.toolCount) + " tools")}`);
    });
    console.log(dim("│"));
    say(o.lang === "zh"
      ? "输入编号切换选中(空格分隔),直接回车确认。"
      : "Type numbers to toggle (space-separated), or press enter to confirm.");
    for (;;) {
      const answer = (await rl.question(bold.cyan("│  > "))).trim();
      if (answer === "") break;
      for (const tok of answer.split(/[\s,]+/)) {
        const n = Number(tok);
        if (!Number.isInteger(n) || n < 1 || n > o.servers.length) continue;
        const slug = o.servers[n - 1].slug;
        if (chosen.has(slug)) chosen.delete(slug);
        else chosen.add(slug);
      }
      draft.servers = [...chosen];
      console.log(dim("│  ") + chalk.green(`${chosen.size} selected: `) + dim([...chosen].join(", ")));
      ({ rev } = await push(o, rev, { draft: { servers: draft.servers } }));
    }
    draft.servers = [...chosen];
    if (draft.servers.length === 0) {
      console.log(dim("└─ ") + chalk.yellow(o.lang === "zh" ? "至少选一个" : "Pick at least one"));
      return undefined;
    }
    console.log(dim("└─ ") + chalk.green(`${draft.servers.length} ✓`));
    await push(o, rev, { step: 5, draft: { servers: draft.servers } });

    return draft;
  } finally {
    rl.close();
  }
}
