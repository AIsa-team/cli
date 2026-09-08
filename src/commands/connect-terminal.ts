import * as readline from "node:readline/promises";
import chalk from "chalk";
import {
  AGENT_BADGE,
  AGENT_NOTES,
  BACKUP_COPY,
  CONFIRM,
  FILE_MODEL_FALLBACK,
  FILE_MODEL_NOTE,
  STEP_AGENT,
  STEP_CAPS,
  STEP_MODELS,
  STEP_TITLES,
  STEP_WELCOME,
  agentRank,
  fill,
  t,
  type Lang,
} from "./flow.js";
import type { ClientInfo, LlmMode, Selection } from "./connect-shared.js";
import { INSTALLERS } from "./install.js";
import { defaultModelsFor } from "./llm-config.js";

import type { LiveServer } from "./mcp.js";
import { httpFetch } from "../utils/http.js";
import { cells } from "../utils/width.js";
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
 * The model options for an agent, by the rule the page already applies.
 *
 * There are three shapes over there and the terminal offered one, so half
 * the agents were asked a question the page does not ask them. A CLI agent
 * yet to be installed chooses between switching and not; an installed one
 * can also keep its own model and put AIsa beside it. VS Code cannot switch:
 * Copilot's models can be joined, not replaced. An app configured through a
 * file is not asked at all — there is nothing here to point at a model, so
 * it gets the note the page shows instead of a menu.
 */
function modelChoices(client: FlowClient): LlmMode[] {
  if (client.kind === "cli") {
    return client.detected ? ["backup", "switch", "skip"] : ["switch", "skip"];
  }
  return client.id === "vscode" ? ["backup", "skip"] : [];
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
  // After the number, before the words: the number says where you are, the
  // glyph says what this one is, and a reader scrolling back finds the glyph
  // first. Terminal only — see the note on STEP_TITLES.
  const title = `${n}/6  ${step.icon}  ${t(step.title, lang)}`;
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
/** Kept as a name because wrap() reads better with it; the maths is shared. */
export const displayWidth = cells;


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
  | { by: "page"; draft: Selection }
  /**
   * Go back to an earlier step.
   *
   * `from` matters because this side has no step 1: a click on the page's
   * first rail step lands the terminal at 2, and echoing that 2 back into the
   * shared position told the page it was on the agent question when it was
   * showing the welcome. A rewind asked for by the page is already recorded
   * there; only one asked for here needs publishing.
   */
  | { by: "back"; to: number; from: "page" | "here" };

/**
 * Thrown by a step when the run has to resume from an earlier one.
 *
 * The steps are written straight down the page, which reads well and cannot
 * jump. Going back is rare enough that unwinding to the loop and starting
 * again from a named step is clearer than turning the whole thing into a
 * state machine for the sake of it.
 */
class Rewind {
  constructor(
    readonly to: number,
    /** False when the page already knows — see Answer's `back`. */
    readonly echo = true
  ) {}
}

/**
 * Where the terminal should stand when the page is on `pageStep`.
 *
 * Step 1 is the welcome, which this side prints on its way past rather than
 * stopping on — so a click on it lands here at the first question.
 */
function terminalStepFor(pageStep: number): number {
  return Math.max(2, pageStep);
}

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
  /** The step being asked; moving past it is what answers it. */
  step: number
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
    let misses = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 900));
      if (stop) return { by: "user", index: fallback };
      const s = await pull(o);
      if (!s) {
        // Never resolves once it gives up, which is right: the typed answer
        // is still coming and this side was never waiting on the page.
        if (++misses >= WATCH_GIVE_UP) return await new Promise<Answer>(() => {});
        continue;
      }
      misses = 0;
      if (s.rev === seenRev || !s.draft) continue;
      // Moving past the step is the only thing that answers it. Treating a
      // changed value as the answer meant picking an agent in the page —
      // without pressing Next — carried both sides straight to the next step.
      if ((s.currentStep ?? 0) > step) {
        return { by: "page", draft: s.draft };
      }
      // And going back is an answer too: clicking an earlier step in the rail
      // means "I want to choose that again", which is not something this side
      // can honour by staying where it is.
      // Compared after translating, not before. The page's step 1 is this
      // side's step 2, so a page sitting on the welcome reads as "behind"
      // a terminal that is already standing exactly where it should — and
      // the question got reprinted every time somebody opened the page.
      if (s.currentStep && terminalStepFor(s.currentStep) < step) {
        return { by: "back", to: terminalStepFor(s.currentStep), from: "page" };
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
  /** Where Escape lands. Without it Escape is ignored, as on step 2. */
  backTo: number | undefined,
  /**
   * Mirror a checklist instead of ending on its first change.
   *
   * A single choice is answered the moment the page makes it, so those steps
   * leave this out and end on `changed`. A checklist is not: ticking a box
   * over there closed this picker and moved the run on, which is why the ✓
   * marks here never followed the page. With `live` the two sides show the
   * same ticks and the step ends only when someone presses Next.
   */
  live?: {
    /** Read the page's set as picker indexes, or undefined if it says nothing. */
    read: (d: Selection) => number[] | undefined;
    /**
     * Publish a local toggle, for a checklist where the keystroke is itself
     * the choice. A single-choice picker leaves this out: moving the cursor
     * is not choosing, any more than hovering a radio button is.
     */
    write?: (indexes: number[]) => Promise<number>;
  }
): Promise<Answer> {
  // The two sides write to the same draft, so a poll that overtakes our own
  // write would paint the state from before it — the box you just ticked
  // un-ticks itself half a second later. Ignore anything older than our last
  // write, and anything at all while one is in flight.
  let floor = seenRev;
  let shown = initial.join(",");
  /** Set by the watcher when the page moved to an earlier step. */
  let back: number | undefined;

  // Holding an arrow key down produces a keystroke every few milliseconds,
  // and one request each would put the page behind the terminal rather than
  // beside it. Only the latest selection is worth sending, so a move made
  // while a write is in flight replaces the one waiting for it.
  let pending: number[] | undefined;
  let flushing = false;
  const flush = async (): Promise<void> => {
    if (flushing || !live?.write) return;
    flushing = true;
    try {
      while (pending) {
        const next = pending;
        pending = undefined;
        floor = Math.max(floor, await live.write(next));
        shown = next.join(",");
      }
    } catch {
      /* the page falls behind; this terminal still finishes the run */
    } finally {
      flushing = false;
    }
  };

  const r = await pick<Selection>({
    title: "",
    choices,
    multi,
    initial,
    hint,
    onToggle: live?.write
      ? (indexes) => {
          pending = indexes;
          void flush();
        }
      : undefined,
    watch: async (signal, apply) => {
      let misses = 0;
      while (!signal.aborted) {
        await new Promise((x) => setTimeout(x, 900));
        if (signal.aborted) return undefined;
        if (flushing || pending) continue;
        const s = await pull(o);
        if (!s) {
          // Stop watching, keep the picker. The keyboard still answers this
          // question — that is the whole point of the two sides being
          // independent — so nothing here should end because a page went.
          if (++misses >= WATCH_GIVE_UP) return undefined;
          continue;
        }
        misses = 0;
        if (s.rev === seenRev || !s.draft) continue;
        if ((s.currentStep ?? 0) > step) return s.draft;
        if (s.currentStep && terminalStepFor(s.currentStep) < step) {
          back = terminalStepFor(s.currentStep);
          return s.draft; // ends the picker; the caller reads `back`
        }
        if (!live || s.rev < floor) continue;
        const indexes = live.read(s.draft);
        if (!indexes) continue;
        const next = indexes.join(",");
        if (next === shown) continue;
        shown = next;
        apply(indexes);
      }
      return undefined;
    },
  });
  if (r.interrupted) {
    if (back !== undefined) return { by: "back", to: back, from: "page" };
    return { by: "page", draft: r.interrupted };
  }
  if (r.escaped) {
    if (backTo === undefined) return { by: "user", index: initial[0] ?? 0, picked: initial };
    return { by: "back", to: backTo, from: "here" };
  }
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

/**
 * How many polls in a row may fail before the terminal stops watching.
 *
 * Not an error: the page is optional, and this side can finish the whole run
 * on its own. But a watcher that keeps asking a port nothing is listening on,
 * every 900ms for as long as the question is open, is spending the user's
 * machine on a conversation that ended.
 */
const WATCH_GIVE_UP = 8;

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
  //
  // Its *position* is part of that state, not just its answers. Adopting the
  // ticks while always restarting at step 2 meant a page sitting on step 4 got
  // asked its first two questions again by a terminal that already knew both
  // answers — and, now that the page follows this side backwards, got dragged
  // back to 2 to watch. Resuming where the run actually stands is the whole
  // difference between two views of one run and two runs that happen to share
  // a draft.
  const seed = await pull(o);
  let resumeAt = 2;
  if (seed) {
    rev = seed.rev;
    if (seed.draft) Object.assign(draft, seed.draft);
    // Cap at the confirmation: 6 is the finished view, and there is nothing
    // for this side to ask once a run has been applied.
    if (seed.currentStep) resumeAt = Math.min(terminalStepFor(seed.currentStep), 5);
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

    // Steps 2 through the confirmation, repeatable — and resumable from any
    // of them. Answering n at the end comes back here, and so does clicking
    // an earlier step in the page's rail: both say "I want to choose that
    // again", and the difference is only which step they land on.
    //
    // What a later step needs from an earlier one lives out here, so
    // resuming at 3 still knows which agent step 2 settled on.
    let confirmed: "go" | "again" = "again";
    let from = resumeAt;
    let client: FlowClient | undefined;
    let modeLabel = "";
    for (;;) {
     try {
      // ── step 2: your agent ──
      if (from <= 2) {
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
            undefined, // step 2 has nothing behind it
            {
              read: (d) => {
                const i = shown.findIndex((c) => c.id === d.clients[0]);
                return i < 0 ? undefined : [i];
              },
              write: async ([i]) => {
                const c = shown[i];
                ({ rev } = await push(o, rev, {
                  draft: { clients: [c.id], install: c.detected ? [] : [c.id] },
                }));
                return rev;
              },
            })
        : await askOrWatch(o, shown.length, preferred, rev, 2);
      if (a1.by === "back") throw new Rewind(a1.to, a1.from === "here");
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
      }
      // Resuming at 3 or later: the agent is whatever step 2 settled on, or
      // whatever the shared draft says if this side never ran that step.
      if (!client) {
        client = o.clients.find((c) => c.id === draft.clients[0]) ?? o.clients.find((c) => c.detected);
        if (!client) return undefined;
      }

      // ── step 3: models ──
      if (from <= 3) {
      console.log(header(3, o.lang));
      say(`${t(STEP_MODELS.h2Prefix, o.lang)}${client.label}${t(STEP_MODELS.h2Suffix, o.lang)}`);
      console.log(dim("│"));
      // The copy carries {model}; the page swaps in an element its script
      // fills, and here the name goes straight in.
      const modelName = defaultModelsFor(client.id).model;
      const brief = (x: { en: string; zh: string }) =>
        plain(t(x, o.lang)).split("{model}").join(modelName);
      const unpicked = !client.detected;
      const copy: Record<LlmMode, { label: string; brief: string }> = {
        backup: {
          label: t(STEP_MODELS.backup.name, o.lang),
          // The page fills this tile with the agent's own backup wording;
          // leaving it blank here described the recommended option in no
          // words at all.
          brief: BACKUP_COPY[client.id] ? brief(BACKUP_COPY[client.id]) : "",
        },
        switch: unpicked
          ? { label: t(STEP_MODELS.freshSwitch.name, o.lang), brief: brief(STEP_MODELS.freshSwitch.brief) }
          : { label: t(STEP_MODELS.switchIt.name, o.lang), brief: brief(STEP_MODELS.switchIt.brief) },
        skip: {
          label: t(STEP_MODELS.notNow.name, o.lang),
          brief: brief(unpicked ? STEP_MODELS.notNow.briefFresh : STEP_MODELS.notNow.briefDetected),
        },
      };
      const modes = modelChoices(client).map((id) => ({ id, ...copy[id] }));
      let mode = modes[0] ?? { id: "backup" as LlmMode, ...copy.backup };

      if (modes.length === 0) {
        // Nothing to choose. Say why in the page's own words and move on,
        // rather than offering a menu it does not offer.
        for (const l of wrap(brief(FILE_MODEL_NOTE[client.id] ?? FILE_MODEL_FALLBACK), 68)) {
          console.log(dim("│  ") + dim(l));
        }
        console.log(dim("└─ ") + dim(o.lang === "zh" ? "这一步没有要选的" : "nothing to choose here"));
      } else {
        modes.forEach((m, i) => {
          const rec = i === 0 ? dim(` (${t(STEP_MODELS.recommended, o.lang)})`) : "";
          console.log(`${dim("│")}   ${bold(String(i + 1) + ")")} ${m.label}${rec}`);
          if (m.brief) for (const l of wrap(m.brief, 68)) console.log(dim("│      ") + dim(l));
        });
        console.log(dim("│"));
        const a2 = interactive()
          ? await pickOrWatch(o, rev, 3,
              modes
                .map((m, i) => ({
                  label: m.label + (i === 0 ? dim(` (${t(STEP_MODELS.recommended, o.lang)})`) : ""),
                }))
                .concat([{ label: dim(t(CONFIRM.goBack, o.lang)) }]),
              false, [0],
              o.lang === "zh" ? "↑↓ 选择 · 回车确认 · esc 返回" : "↑↓ move · enter to confirm · esc to go back",
              2,
              {
                read: (d) => {
                  const i = modes.findIndex((m) => m.id === d.llmMode);
                  return i < 0 ? undefined : [i];
                },
                write: async ([i]) => {
                  ({ rev } = await push(o, rev, { draft: { llmMode: modes[i].id } }));
                  return rev;
                },
              })
          : await askOrWatch(o, modes.length, 0, rev, 3);
        if (a2.by === "back") throw new Rewind(a2.to, a2.from === "here");
        // The extra row is the way back. Steps 3 and 4 are the two where a
        // person can realise they picked the wrong thing a moment ago; 2 has
        // nothing behind it and 5 already asks.
        if (a2.by === "user" && a2.index === modes.length) throw new Rewind(2);
        if (a2.by === "page") {
          mode = modes.find((m) => m.id === a2.draft.llmMode) ?? modes[0];
          Object.assign(draft, a2.draft);
          const s = await pull(o); if (s) rev = s.rev;
          console.log("\n" + dim("│  ") + chalk.magenta(o.lang === "zh" ? "↩ 已在页面中选择" : "↩ chosen in the page"));
        } else {
          mode = modes[a2.index];
        }
        console.log(dim("└─ ") + chalk.green(mode.label) + " ✓");
      }
      draft.llmMode = mode.id;
      modeLabel = mode.label;
      ({ rev } = await push(o, rev, { step: 4, draft: { llmMode: draft.llmMode } }));
      }

      // ── step 4: capabilities ──
      if (from <= 4) {
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
        // Grouped by area, with the area named once above its rows.
        //
        // A category column beside every row said "SEO & Search Data" twelve
        // times out of twenty-five — the same word repeated is not something
        // to read, and the list is sorted by slug so it could not even group.
        // Said once over a run of rows it does both jobs at once.
        //
        // The rows a user can act on are a subset of the rows on screen from
        // here on, so everything that indexes them goes through `rowOf`.
        const grouped: Array<{ cat?: string; server?: LiveServer }> = [];
        const ordered = [...o.servers].sort(
          (a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug)
        );
        let area = "";
        for (const srv of ordered) {
          if (srv.category !== area) { area = srv.category; grouped.push({ cat: area }); }
          grouped.push({ server: srv });
        }
        /** Row index → server, for the rows that carry one. */
        const rowOf = grouped.map((g) => g.server);
        const rowFor = (slug: string) => rowOf.findIndex((s) => s?.slug === slug);
        const initial = [...chosen].map(rowFor).filter((i) => i >= 0);
        const a3 = await pickOrWatch(o, rev, 4,
          grouped.map((g) =>
            g.cat
              ? { header: true, label: g.cat }
              : {
                  label: g.server!.slug,
                  meta: `${g.server!.toolCount} ${t(STEP_CAPS.toolsWord, o.lang)}`,
                  // Straight from the host, the same sentence the page shows.
                  // A hand-written table here would be a second source of
                  // truth for something that ships with the server.
                  detail: g.server!.description,
                }
          ),
          true, initial,
          o.lang === "zh"
            ? "↑↓ 移动 · 空格勾选 · a 全选/全不选 · 回车确认 · esc 返回上一步"
            : "↑↓ move · space to tick · a for all · enter to confirm · esc to go back",
          3,
          {
            read: (d) =>
              d.servers === undefined ? undefined : d.servers.map(rowFor).filter((i) => i >= 0),
            write: async (indexes) => {
              const next = indexes.map((i) => rowOf[i]?.slug).filter((x): x is string => Boolean(x));
              ({ rev } = await push(o, rev, { draft: { servers: next } }));
              return rev;
            },
          });
        // In a checklist the way back cannot be another row — a row is a
        // thing you tick — so Escape is the gesture, and the hint says so.
        if (a3.by === "back") throw new Rewind(a3.to, a3.from === "here");
        if (a3.by === "page") {
          chosen.clear();
          for (const slug of a3.draft.servers ?? []) chosen.add(slug);
          const s2 = await pull(o); if (s2) rev = s2.rev;
          console.log("\n" + dim("│  ") + chalk.magenta(o.lang === "zh" ? "↩ 已在页面中选择" : "↩ chosen in the page"));
        } else {
          chosen.clear();
          for (const i of a3.picked ?? []) { const srv = rowOf[i]; if (srv) chosen.add(srv.slug); }
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
      }

      // ── step 5: confirm ──
      // Everything above was browsing and could be undone by closing the
      // window. This is where the machine changes, so it asks for a word rather
      // than a keystroke — enter alone is too easy to hit on the way past.
      console.log(header(5, o.lang));
      say(t(CONFIRM.heading, o.lang));
      console.log(dim("│"));
      if (!modeLabel) modeLabel = draft.llmMode;
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
          // Dim, like the way-back row on the models step. A way out of a
          // screen is not one of the things the screen offers, and rendering
          // it as brightly as the action it declines reads as a second offer.
          { label: dim(t(CONFIRM.goBack, o.lang)) },
        ],
        multi: false,
        initial: [0],
        // Escape does the same as picking the way-back row - `r.aborted`
        // falls through to "again" below - so the hint says so. Steps 3
        // and 4 both advertise it and this one did not, which made the
        // key look like it did nothing here.
        hint: o.lang === "zh" ? "↑↓ 选择 · 回车确认 · esc 返回修改"
                              : "↑↓ move · enter to confirm · esc to go back",
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

     } catch (e) {
      if (!(e instanceof Rewind)) throw e;
      // Somebody asked for an earlier step — the page's rail, or a way-back
      // row here. Start again from there with everything else still in hand.
      from = e.to;
      console.log("\n" + dim("│  ") + chalk.magenta(
        o.lang === "zh" ? `↩ 回到第 ${from} 步` : `↩ back to step ${from}`
      ));
      if (e.echo) ({ rev } = await push(o, rev, { step: from }));
      continue;
     }

      // "Go back and change something" at the confirmation lands on the model
      // step, not the agent: an agent you already picked is rarely the thing
      // you came back to change, and making you pick it again to reach the
      // rest is a toll rather than a choice.
      if (confirmed === "again") { from = 3; ({ rev } = await push(o, rev, { step: 3 })); continue; }
      from = 2;
      break;
    }

    return draft;
  } finally {
    // Whatever happened, the terminal goes back cooked. A flow that threw
    // while a picker was open used to leave it raw.
    restoreTerminal();
  }
}
