import * as readline from "node:readline/promises";
import chalk from "chalk";
import {
  STEP_TITLES, STEP_WELCOME, STEP_AGENT, STEP_MODELS, STEP_CAPS, agentRank,
  AGENT_BADGE, AGENT_NOTES, CONFIRM, t, fill, type Lang,
} from "./flow.js";
import type { ClientInfo, LlmMode, Selection } from "./connect-shared.js";
import { INSTALLERS } from "./install.js";
import { defaultModelsFor } from "./llm-config.js";

import type { LiveServer } from "./mcp.js";
import { httpFetch } from "../utils/http.js";
import { pick, interactive, restoreTerminal, type Choice } from "./prompt.js";

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

/**
 * Ask for a line, on an interface that exists only for this question.
 *
 * A readline kept open across the whole flow does not survive the arrow-key
 * pickers beside it: those put stdin in raw mode, and the interface that was
 * listening before is left attached to a stdin whose mode changed underneath
 * it. The result was a prompt that echoed nothing and accepted nothing, with
 * no way out but killing the terminal.
 *
 * One question, one interface, closed before anything else touches stdin.
 */
async function askLine(prompt: string): Promise<string> {
  // Cooked mode first: a picker may have just been open, and readline on a raw
  // stdin accepts nothing.
  restoreTerminal();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
    // Whatever happened, the terminal goes back cooked. A flow that threw
    // while a picker was open used to leave it raw.
    restoreTerminal();
  }
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

/** Two columns wide in a terminal: CJK, and the punctuation that comes with it. */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Display width, not character count — one CJK glyph occupies two cells. */
export function displayWidth(text: string): number {
  let n = 0;
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

/**
 * Wrap to the terminal width.
 *
 * Splitting on spaces alone is wrong for Chinese, which has none: a whole
 * sentence arrives as one "word" and the line runs far past the margin —
 * observed on the welcome step, where a paragraph overflowed by half a line.
 * So a run that is itself too wide is broken between characters, and width is
 * measured in cells rather than characters because CJK glyphs take two.
 */
export function wrap(text: string, width = Math.min(process.stdout.columns || 80, 84)): string[] {
  const out: string[] = [];
  let line = "";
  const flush = () => { if (line) { out.push(line); line = ""; } };

  const breakWide = (word: string) => {
    let chunk = "";
    for (const ch of word) {
      if (displayWidth(chunk + ch) > width) { out.push(chunk); chunk = ""; }
      chunk += ch;
    }
    return chunk;
  };

  for (const word of text.split(" ")) {
    const sep = line ? 1 : 0;
    if (line && displayWidth(line) + sep + displayWidth(word) > width) flush();
    if (displayWidth(word) > width) {
      flush();
      line = breakWide(word);
      continue;
    }
    line = line ? `${line} ${word}` : word;
  }
  flush();
  return out;
}

function say(text: string, indent = "│  "): void {
  for (const line of wrap(plain(text))) console.log(dim(indent) + line);
}

/** What happened to a question: the user typed, or the page answered it. */
type Answer =
  | { by: "user"; index: number; picked?: number[] }
  | { by: "page"; draft: Selection };

/**
 * Ask one question, while watching for the page to answer it instead.
 *
 * Waiting on readline alone is what made the terminal look dead: a person who
 * ticked a card in the browser saw nothing happen here, because this side
 * only looked at the shared draft between questions. So the prompt races
 * against a poll, and whichever resolves first wins the step.
 *
 * The abandoned readline promise cannot be cancelled — it stays pending on a
 * closed interface, which is harmless — but the caller must not ask again on
 * the same interface after the page wins, so each step reads at most once.
 */
async function askOrWatch(
  o: TerminalFlowOptions,
  count: number,
  fallback: number,
  seenRev: number,
  /** The step being asked, so moving past it counts as an answer. */
  step: number,
  changed: (d: Selection) => boolean
): Promise<Answer> {
  let stop = false;

  const typed = (async (): Promise<Answer> => {
    for (;;) {
      const answer = await askLine(bold.cyan("│  > "));
      if (stop) return { by: "user", index: fallback };
      if (answer === "") return { by: "user", index: fallback };
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= count) return { by: "user", index: n - 1 };
      console.log(dim("│  ") + chalk.yellow(`1–${count}`));
    }
  })();

  const watched = (async (): Promise<Answer> => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 900));
      if (stop) return { by: "user", index: fallback };
      const s = await pull(o);
      if (!s || s.rev === seenRev || !s.draft) continue;
      // Two ways the page can answer this step: change the value, or move
      // past it. Watching only for a change meant a page whose default was
      // already right — pressing Next without touching anything — left the
      // terminal waiting on a question that had been settled.
      if (changed(s.draft) || (s.currentStep ?? 0) > step) {
        return { by: "page", draft: s.draft };
      }
    }
  })();

  const winner = await Promise.race([typed, watched]);
  stop = true;
  return winner;
}

/**
 * The arrow-key picker, racing the same watch the typed prompt races.
 *
 * Returns the same Answer shape either way, so a step does not care which
 * input the terminal was able to offer.
 */
async function pickOrWatch(
  o: TerminalFlowOptions,
  seenRev: number,
  step: number,
  choices: Choice[],
  multi: boolean,
  initial: number[],
  hint: string,
  changed: (d: Selection) => boolean
): Promise<Answer> {
  const r = await pick<Selection>({
    title: "",
    choices,
    multi,
    initial,
    hint,
    watch: async (signal) => {
      while (!signal.aborted) {
        await new Promise((x) => setTimeout(x, 900));
        if (signal.aborted) return undefined;
        const s = await pull(o);
        if (!s || s.rev === seenRev || !s.draft) continue;
        if (changed(s.draft) || (s.currentStep ?? 0) > step) return s.draft;
      }
      return undefined;
    },
  });
  if (r.interrupted) return { by: "page", draft: r.interrupted };
  return { by: "user", index: r.picked?.[0] ?? initial[0] ?? 0, picked: r.picked };
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
    const body = (await res.json()) as { ok?: boolean; rev: number; draft?: Selection };
    // A stale rev means someone wrote while this was being typed — but they
    // wrote a different field, and dropping this write silently is worse than
    // the conflict it was meant to catch. Retry once against what is now
    // current. Without this the terminal's step never landed: the page
    // publishes its step on load, and every later terminal write was refused.
    if (body.ok === false) {
      const retry = await httpFetch(`${o.baseUrl}/select?token=${o.token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rev: body.rev, ...patch }),
        timeoutMs: 5_000,
      });
      return (await retry.json()) as { rev: number; draft?: Selection };
    }
    return body;
  } catch {
    return { rev };
  }
}

/** Read the shared draft, to pick up whatever the page did. */
async function pull(
  o: TerminalFlowOptions
): Promise<{ rev: number; draft?: Selection; currentStep?: number } | undefined> {
  try {
    const res = await httpFetch(`${o.baseUrl}/status?token=${o.token}`, {
      idempotent: true,
      maxAttempts: 1,
      timeoutMs: 3_000,
    });
    const s = (await res.json()) as { rev?: number; draft?: Selection; currentStep?: number };
    return { rev: s.rev ?? 0, draft: s.draft, currentStep: s.currentStep };
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
    // Steps 2–5 are one loop, because "n" at the confirmation means go back
    // and change something — not abandon the run. Answering no used to end
    // the process, which is the opposite of what the word offers.
    // ── step 1: welcome ──
    // The page opens on this and the terminal used to skip straight past it,
    // which left the one surface that cannot be scrolled back through with no
    // answer to "what am I about to get". Same four points, without the tiles.
    console.log(header(1, o.lang));
    say(t(STEP_WELCOME.h1, o.lang));
    console.log(dim("│"));
    say(t(STEP_WELCOME.lede, o.lang));
    console.log(dim("│"));
    for (const tile of STEP_WELCOME.tiles) {
      console.log(dim("│  ") + chalk.bold("· " + plain(t(tile.h3, o.lang))));
      for (const line of wrap(plain(t(tile.p, o.lang)), 74)) {
        console.log(dim("│    ") + dim(line));
      }
    }
    console.log(dim("└─"));

    // Steps 2 through the confirmation, repeatable: answering n at the end
    // brings you back here with what you chose still in hand.
    let confirmed: "go" | "again" = "again";
    for (;;) {
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
      const a1 = interactive()
        ? await pickOrWatch(o, rev, 2,
            shown.map((c) => ({
              label: c.label,
              meta: c.detected ? t(AGENT_BADGE.detected, o.lang) : t(AGENT_BADGE.absent, o.lang),
            })),
            false, [preferred],
            o.lang === "zh" ? "↑↓ 选择 · 回车确认" : "↑↓ move · enter to confirm",
            (d) => Boolean(d.clients[0]) && d.clients[0] !== draft.clients[0])
        : await askOrWatch(o, shown.length, preferred, rev, 2,
            (d) => Boolean(d.clients[0]) && d.clients[0] !== draft.clients[0]);
      let client: FlowClient;
      if (a1.by === "page") {
        // Answered in the browser. Say so rather than redrawing silently —
        // seeing why the prompt moved on is the whole point.
        client = shown.find((c) => c.id === a1.draft.clients[0]) ?? shown[preferred];
        Object.assign(draft, a1.draft);
        const s = await pull(o); if (s) rev = s.rev;
        console.log("\n" + dim("│  ") + chalk.magenta(o.lang === "zh" ? "↩ 已在页面中选择" : "↩ chosen in the page"));
      } else {
        client = shown[a1.index];
      }
      draft.clients = [client.id];
      draft.install = client.detected ? [] : [client.id];
      console.log(dim("└─ ") + chalk.green(client.label) + " ✓");
      if (AGENT_NOTES[client.id]) say(t(AGENT_NOTES[client.id], o.lang), "   ");
      ({ rev } = await push(o, rev, { step: 3, draft: { clients: draft.clients, install: draft.install } }));

      // ── step 3: models ──
      console.log(header(3, o.lang));
      say(`${t(STEP_MODELS.h2Prefix, o.lang)}${client.label}${t(STEP_MODELS.h2Suffix, o.lang)}`);
      console.log(dim("│"));
      // The copy carries {model}; the page swaps in an element its script
      // fills, and here the name goes straight in.
      const modelName = defaultModelsFor(client.id).model;
      const brief = (x: { en: string; zh: string }) =>
        plain(t(x, o.lang)).split("{model}").join(modelName);
      const modes: Array<{ id: LlmMode; label: string; brief: string }> = client.detected
        ? [
            { id: "backup", label: t(STEP_MODELS.backup.name, o.lang), brief: "" },
            { id: "switch", label: t(STEP_MODELS.switchIt.name, o.lang), brief: brief(STEP_MODELS.switchIt.brief) },
            { id: "skip", label: t(STEP_MODELS.notNow.name, o.lang), brief: brief(STEP_MODELS.notNow.briefDetected) },
          ]
        : [
            { id: "switch", label: t(STEP_MODELS.freshSwitch.name, o.lang), brief: brief(STEP_MODELS.freshSwitch.brief) },
            { id: "skip", label: t(STEP_MODELS.notNow.name, o.lang), brief: brief(STEP_MODELS.notNow.briefFresh) },
          ];
      modes.forEach((m, i) => {
        const rec = i === 0 ? dim(` (${t(STEP_MODELS.recommended, o.lang)})`) : "";
        console.log(`${dim("│")}   ${bold(String(i + 1) + ")")} ${m.label}${rec}`);
        if (m.brief) for (const l of wrap(m.brief, 68)) console.log(dim("│      ") + dim(l));
      });
      console.log(dim("│"));
      const a2 = interactive()
        ? await pickOrWatch(o, rev, 3,
            modes.map((m, i) => ({
              label: m.label + (i === 0 ? dim(` (${t(STEP_MODELS.recommended, o.lang)})`) : ""),
            })),
            false, [0],
            o.lang === "zh" ? "↑↓ 选择 · 回车确认" : "↑↓ move · enter to confirm",
            (d) => Boolean(d.llmMode) && d.llmMode !== draft.llmMode)
        : await askOrWatch(o, modes.length, 0, rev, 3,
            (d) => Boolean(d.llmMode) && d.llmMode !== draft.llmMode);
      let mode = modes[0];
      if (a2.by === "page") {
        mode = modes.find((m) => m.id === a2.draft.llmMode) ?? modes[0];
        Object.assign(draft, a2.draft);
        const s = await pull(o); if (s) rev = s.rev;
        console.log("\n" + dim("│  ") + chalk.magenta(o.lang === "zh" ? "↩ 已在页面中选择" : "↩ chosen in the page"));
      } else {
        mode = modes[a2.index];
      }
      draft.llmMode = mode.id;
      console.log(dim("└─ ") + chalk.green(mode.label) + " ✓");
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
      if (interactive()) {
        const initial = o.servers.map((s, i) => (chosen.has(s.slug) ? i : -1)).filter((i) => i >= 0);
        const a3 = await pickOrWatch(o, rev, 4,
          o.servers.map((s) => ({
            label: s.slug,
            meta: `${s.toolCount} ${t(STEP_CAPS.toolsWord, o.lang)}`,
          })),
          true, initial,
          o.lang === "zh"
            ? "↑↓ 移动 · 空格勾选 · a 全选/全不选 · 回车确认"
            : "↑↓ move · space to tick · a for all · enter to confirm",
          (d) => (d.servers ?? []).join(",") !== [...chosen].join(","));
        if (a3.by === "page") {
          chosen.clear();
          for (const slug of a3.draft.servers ?? []) chosen.add(slug);
          const s2 = await pull(o); if (s2) rev = s2.rev;
          console.log("\n" + dim("│  ") + chalk.magenta(o.lang === "zh" ? "↩ 已在页面中选择" : "↩ chosen in the page"));
        } else {
          chosen.clear();
          for (const i of a3.picked ?? []) chosen.add(o.servers[i].slug);
        }
      } else {
        o.servers.forEach((s, i) => {
          const mark = chosen.has(s.slug) ? chalk.green("[x]") : dim("[ ]");
          console.log(`${dim("│")}  ${mark} ${bold(String(i + 1).padStart(2))}) ${s.slug.padEnd(24)} ${dim(String(s.toolCount) + " " + t(STEP_CAPS.toolsWord, o.lang))}`);
        });
        console.log(dim("│"));
        say(o.lang === "zh"
          ? "输入编号切换选中(空格分隔),直接回车确认。"
          : "Type numbers to toggle (space-separated), or press enter to confirm.");
        for (;;) {
          const answer = await askLine(bold.cyan("│  > "));
          if (answer === "") break;
          for (const tok of answer.split(/[\s,]+/)) {
            const n = Number(tok);
            if (!Number.isInteger(n) || n < 1 || n > o.servers.length) continue;
            const slug = o.servers[n - 1].slug;
            if (chosen.has(slug)) chosen.delete(slug);
            else chosen.add(slug);
          }
          console.log(dim("│  ") + chalk.green(`${chosen.size} selected: `) + dim([...chosen].join(", ")));
          ({ rev } = await push(o, rev, { draft: { servers: [...chosen] } }));
        }
      }
      draft.servers = [...chosen];
      if (draft.servers.length === 0) {
        console.log(dim("└─ ") + chalk.yellow(o.lang === "zh" ? "至少选一个" : "Pick at least one"));
        return undefined;
      }
      console.log(dim("└─ ") + chalk.green(`${draft.servers.length} ✓`));
      // Publish the choice but NOT the step: arriving at step 5 is what makes
      // the page start the run by itself, and the user has not confirmed yet.
      // Announcing the step here applied everything without being asked.
      ({ rev } = await push(o, rev, { draft: { servers: draft.servers } }));

      // ── step 5: confirm ──
      // Everything above was browsing and could be undone by closing the
      // window. This is where the machine changes, so it asks for a word rather
      // than a keystroke — enter alone is too easy to hit on the way past.
      console.log(header(5, o.lang));
      say(t(CONFIRM.heading, o.lang));
      console.log(dim("│"));
      const modeLabel = modes.find((m) => m.id === draft.llmMode)?.label ?? draft.llmMode;
      console.log(`${dim("│")}   ${t(CONFIRM.agent, o.lang)}: ${chalk.bold(client.label)}`);
      console.log(`${dim("│")}   ${t(CONFIRM.models, o.lang)}: ${chalk.bold(modeLabel)}`);
      console.log(`${dim("│")}   ${t(CONFIRM.capabilities, o.lang)}: ${chalk.bold(String(draft.servers.length))}  ${dim(draft.servers.join(", "))}`);
      console.log(dim("│"));
      if (interactive()) {
      const r = await pick<never>({
        title: "",
        // Applying is first and where the cursor starts. It was the other
        // way round, to keep a stray return from writing anything — but by
        // this point the summary above says exactly what will happen, and
        // making the common answer cost two keystrokes is its own kind of
        // wrong. Escape still leaves without applying.
        choices: [
          { label: chalk.green.bold(t(CONFIRM.apply, o.lang)) },
          { label: chalk.bold(t(CONFIRM.goBack, o.lang)) },
        ],
        multi: false,
        initial: [0],
        hint: o.lang === "zh" ? "↑↓ 选择 · 回车确认" : "↑↓ move · enter to confirm",
      });
      confirmed = !r.aborted && r.picked?.[0] === 0 ? "go" : "again";
      console.log(dim("└─ ") + (confirmed === "go"
        ? chalk.green(t(CONFIRM.apply, o.lang) + " ✓")
        : chalk.yellow(t(CONFIRM.backToEdit, o.lang))));
    } else {
      say(t(CONFIRM.ask, o.lang) + " — ok / n");
      // Bounded, and empty means no. A closed pipe returns "" forever, and
      // asking again each time printed the prompt down the screen until it
      // ran into whatever came next. Three tries is a person mistyping; more
      // than that is not a person.
      let tries = 0;
      for (;;) {
        const said = (await askLine(bold.cyan("│  > "))).toLowerCase();
        if (["ok", "yes", "y", "是", "好"].includes(said)) { confirmed = "go"; break; }
        // Empty means no here, unlike the picker above where enter on the
        // highlighted row means yes. Deliberately different: with no
        // terminal, an empty line is usually a closed pipe rather than
        // someone agreeing, and EOF must not write to a machine.
        if (said === "" || ["n", "no", "否"].includes(said)) { confirmed = "again"; break; }
        if (++tries >= 3) { confirmed = "again"; break; }
        console.log(dim("│  ") + chalk.yellow("ok / n"));
      }
      console.log(dim("└─ ") + (confirmed === "go"
        ? chalk.green("ok ✓")
        : chalk.yellow(t(CONFIRM.backToEdit, o.lang))));
    }

    if (confirmed === "again") continue;
    break;
    }

    return draft;
  } finally {
    // Whatever happened, the terminal goes back cooked. A flow that threw
    // while a picker was open used to leave it raw.
    restoreTerminal();
  }
}
