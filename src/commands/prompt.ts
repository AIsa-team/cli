import chalk from "chalk";
import { cells, padTo, truncate } from "../utils/width.js";

/**
 * Arrow-key pickers for the connect flow.
 *
 * The first version asked for numbers: "type 3 5 to toggle". It worked, but
 * nothing moved while you thought — you typed into the dark and found out
 * afterwards what you had done. Twenty-five servers is far too many to hold
 * in your head that way.
 *
 * These redraw in place instead, so the cursor and the ticks are where your
 * attention already is.
 *
 * ── Falling back ──────────────────────────────────────────────────────────
 * Raw mode needs a real terminal. Piped input, CI, an editor's embedded
 * console — none of them can deliver an arrow key, so `interactive()` says so
 * and the caller keeps the typed-number path for those. The flow must work in
 * both; this is a nicer way through, not the only one.
 *
 * ── Redrawing ─────────────────────────────────────────────────────────────
 * Every frame is "move the cursor up as many lines as were printed, clear to
 * the bottom, print again". That means the number of lines has to be exact —
 * a wrapped line counts twice and the frame walks up the screen — so the
 * viewport is sized against the window and long labels are cut, not wrapped.
 */

/**
 * Raw mode, and getting out of it.
 *
 * A process that exits while the terminal is raw leaves the user with no echo
 * and no line editing — a shell that looks hung and is usually fixed by
 * closing the window. That happened, so leaving it is not left to the happy
 * path: the handlers below run on every way out, including a crash.
 */
let rawDepth = 0;
let handlersInstalled = false;

function leaveRaw(): void {
  if (rawDepth === 0) return;
  rawDepth = 0;
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.resume();
  } catch {
    /* the terminal is going away anyway */
  }
}

function enterRaw(): void {
  if (!handlersInstalled) {
    handlersInstalled = true;
    process.on("exit", leaveRaw);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(sig, () => {
        leaveRaw();
        process.exit(130);
      });
    }
    process.on("uncaughtException", (e) => {
      leaveRaw();
      throw e;
    });
  }
  rawDepth++;
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

/** Put the terminal back the way a shell expects it. Safe to call twice. */
export function restoreTerminal(): void {
  leaveRaw();
  drain();
}

/**
 * Throw away anything typed but not yet consumed.
 *
 * Switching between raw mode and readline leaves whatever was in flight for
 * the other reader: the return that confirmed a picker arrived at the next
 * readline as an empty line, which re-asked, which read the next stray byte —
 * the prompt repeated down the screen and ran into the one after it.
 */
function drain(): void {
  try {
    while (process.stdin.read() !== null) {
      /* discard */
    }
  } catch {
    /* nothing buffered, or not readable — either is fine */
  }
}

/** Can this terminal deliver arrow keys? */
export function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export interface Choice {
  /**
   * A group heading rather than a choice.
   *
   * The capability list is twenty-five rows over eight areas, and a category
   * column repeated down the side said "SEO & Search Data" twelve times —
   * which is not information, it is the same word twelve times. Said once
   * over a group it is a heading, and the rows under it inherit it.
   *
   * Everything that acts on a row skips these: the cursor steps over them,
   * space cannot tick them, "all" does not count them, and they are never
   * returned as a pick. They occupy a row and nothing else.
   */
  header?: boolean;
  /** Left column, already coloured. */
  label: string;
  /** Right column, dimmed. Cut before it can wrap. */
  meta?: string;
  /** Extra lines under the cursor's row only. */
  detail?: string;
}

interface Keys {
  up: boolean;
  down: boolean;
  space: boolean;
  enter: boolean;
  abort: boolean;
  escape: boolean;
  digit?: number;
  all?: boolean;
}

function decode(data: string): Keys {
  return {
    up: data === "[A" || data === "k",
    down: data === "[B" || data === "j",
    space: data === " ",
    enter: data === "\r" || data === "\n",
    abort: data === "",
    // Escape leaves the question rather than answering it. It used to share
    // the abort path, where "abort" meant the caller took the highlighted row
    // — so the key that means "no, wait" quietly agreed to whatever the
    // cursor was on. Now it has its own way out and callers decide where it
    // goes: back a step, in the flow that uses it.
    escape: data === "",
    all: data === "a",
    digit: /^[0-9]$/.test(data) ? Number(data) : undefined,
  };
}

/** Room for the list, leaving the header and footer their lines. */
function viewport(total: number, reserved: number): number {
  const rows = process.stdout.rows || 24;
  return Math.max(3, Math.min(total, rows - reserved));
}

interface RenderOptions {
  title: string;
  hint: string;
  choices: Choice[];
  cursor: number;
  selected?: Set<number>;
  offset: number;
  rows: number;
  /** Set when any choice has a detail; zero turns the block off entirely. */
  detailWidth?: number;
}

/**
 * How many lines the cursor's description gets.
 *
 * Two, and always two whether the row has a description or not. A block that
 * grows and shrinks as you move makes the list itself jump under the cursor,
 * which is a worse cost than a blank line on the rows that have nothing to
 * say — and the viewport has to reserve the space either way.
 */
const DETAIL_ROWS = 3;

/** Break to a cell width. Plain text only; details arrive unpainted. */
function wrapCells(text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (!line) { line = word; continue; }
    if (cells(line) + 1 + cells(word) > width) {
      out.push(line);
      if (out.length === max) return capped(out, text, width, max);
      line = word;
    } else {
      line += " " + word;
    }
  }
  if (line) out.push(line);
  return out.slice(0, max);
}

/** The last line says there is more, rather than stopping mid-sentence. */
function capped(out: string[], _text: string, width: number, max: number): string[] {
  // truncate adds its own ellipsis when it cuts; adding a second one here
  // produced "…at four depths, web plus academic searc……".
  const last = truncate(out[max - 1] + " …", Math.max(1, width));
  return [...out.slice(0, max - 1), last];
}

function frame(o: RenderOptions): string[] {
  const lines: string[] = [];
  const width = Math.min(process.stdout.columns || 80, 90) - 6;
  // Size both columns to the content instead of to a constant.
  //
  // The right column was capped at eighteen cells — right for a list of
  // twenty-five servers whose metas are all "29 tools", wrong for the
  // three-row menu that ends a run, where the meta is the sentence saying
  // what the command does. "gpt-5.3-codex via AIsa — your usual codex is
  // untouched" arrived as "gpt-5.3-codex via …", so the row that mattered
  // most was the one least readable.
  //
  // Labels are padded to a common width too, so the metas start in one
  // column rather than wherever each label happened to end.
  // The cap only reserves room for a meta column when there is one. Charging
  // every list twenty-four columns for a column it may not have is what cut
  // "Add AIsa beside it (recommended)" — a four-row menu whose rows carry
  // nothing but their label, paying for a second column that was never drawn.
  const anyMeta = o.choices.some((c) => c.meta);
  const pickable = o.choices.filter((c) => !c.header);
  const labelW = Math.min(
    Math.max(...(pickable.length ? pickable : o.choices).map((c) => cells(c.label))),
    Math.max(8, width - (anyMeta ? 24 : 4))
  );
  const metaW = Math.max(10, width - labelW - 6);
  for (let i = o.offset; i < Math.min(o.offset + o.rows, o.choices.length); i++) {
    const c = o.choices[i];
    if (c.header) {
      // Set back from the rows it covers, so it reads as a lid rather than
      // as another row that happens to have no tick.
      lines.push(chalk.gray("│  ") + chalk.gray.bold(c.label));
      continue;
    }
    const here = i === o.cursor;
    const on = Boolean(o.selected?.has(i));
    // Four states, four looks. Before this, "where I am" and "what I picked"
    // were drawn the same way — a cyan bar for the cursor and a green tick
    // inside it — so on the row you were standing on there was no telling
    // whether it was ticked. Chosen is a filled green bar; the cursor alone
    // is an outline; the rest recede.
    const mark = o.selected ? (on ? "✓" : " ") : here ? "▶" : " ";
    const body = padTo(truncate(c.label, labelW), labelW);
    const meta = c.meta ? "  " + truncate(c.meta, metaW) : "";
    const row = ` ${mark} ${body}${meta} `;

    let painted: string;
    if (on && here) painted = chalk.bgGreen.black.bold(row);
    else if (on) painted = chalk.green.bold(row);
    else if (here) painted = chalk.bgWhite.black(row);
    else painted = " " + mark + " " + body + chalk.gray(meta) + " ";

    lines.push(chalk.gray("│") + painted);
    // Under the cursor only. Twenty-five rows each carrying a sentence is
    // twenty-five sentences to read past; one that follows the cursor is a
    // sentence about the thing you are looking at, and moving is already the
    // gesture for "tell me about the next one" — nothing to explain.
    if (here && o.detailWidth) {
      const body = o.choices[i].detail
        ? wrapCells(o.choices[i].detail!, o.detailWidth, DETAIL_ROWS)
        : [];
      for (let k = 0; k < DETAIL_ROWS; k++) {
        lines.push(chalk.gray("│      " + (body[k] ?? "")));
      }
    }
  }
  if (o.choices.length > o.rows) {
    // Counted in things you can pick, not in rows drawn. With group headings
    // in the list the two differ — twenty-five servers were reported as
    // "6–15 / 33", a total the user has no way to make sense of.
    const before = o.choices.slice(0, o.offset).filter((c) => !c.header).length;
    const here = o.choices.slice(o.offset, o.offset + o.rows).filter((c) => !c.header).length;
    lines.push(chalk.gray(`│   ${before + 1}–${before + here} / ${pickable.length}`));
  }
  // The keys are the one thing a first-time reader has to see. Dimming them
  // put the only instructions on the screen below everything else in
  // contrast — exactly backwards.
  lines.push(chalk.gray("│  ") + chalk.cyan.bold(o.hint));
  return lines;
}

/**
 * Watch for a change made somewhere else while the picker is open.
 *
 * Given a signal that fires the moment the picker is done, because a watcher
 * that outlives it never stops: each step left one behind, polling every 900ms
 * for the life of the process — three steps, three pollers, still running long
 * after the run had finished.
 */
export type Interrupt<T> = (
  signal: AbortSignal,
  /**
   * Repaint with a selection made elsewhere, without ending the picker.
   *
   * A checklist is not answered by its first tick. Treating every change in
   * the page as the answer closed this picker on the first box ticked over
   * there and moved the run on; a person ticking their way down twenty-five
   * servers should see the ✓ marks arrive here and keep going.
   */
  apply: (indexes: number[]) => void
) => Promise<T | undefined>;

export interface PickResult<T> {
  /** Indexes chosen here, or undefined when something else answered. */
  picked?: number[];
  /** Whatever the interrupt resolved with. */
  interrupted?: T;
  aborted?: boolean;
  /** Escape: the question was left rather than answered. */
  escaped?: boolean;
}

/**
 * Draw a picker until the user commits, or `watch` resolves.
 *
 * `multi` decides whether space toggles and enter confirms a set, or the
 * cursor itself is the answer.
 */
export async function pick<T>(opts: {
  title: string;
  choices: Choice[];
  multi: boolean;
  initial?: number[];
  cursor?: number;
  hint: string;
  watch?: Interrupt<T>;
  /**
   * Called whenever the local selection changes, so the other side can follow.
   *
   * On a checklist that is a tick; on a single choice it is the cursor
   * itself, which is the only way this terminal has of saying "this one" —
   * it is painted as chosen, so treating the move as a hover left the page
   * showing nothing while the terminal plainly showed something.
   */
  onToggle?: (indexes: number[]) => void;
}): Promise<PickResult<T>> {
  const selected = new Set(opts.initial ?? []);
  const isHeader = (i: number) => Boolean(opts.choices[i]?.header);
  /** The next pickable row in a direction, wrapping. Headers are not rows. */
  const step = (from: number, by: number): number => {
    const n = opts.choices.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + by * k + n * k) % n;
      if (!isHeader(i)) return i;
    }
    return from;
  };
  let cursor = opts.cursor ?? (opts.initial?.[0] ?? 0);
  if (isHeader(cursor)) cursor = step(cursor, 1);
  let offset = 0;
  // The block under the cursor is part of the frame, so the viewport has to
  // pay for it — otherwise the frame outgrows the window and the redraw walks
  // up the screen.
  const hasDetail = opts.choices.some((c) => c.detail);
  // Seven of these columns are the gutter this block is printed in; the rest
  // is sentence. The first version left fourteen unused, which cost it most
  // of a line on every wrap.
  const detailWidth = hasDetail ? Math.min(process.stdout.columns || 80, 96) - 9 : 0;
  const rows = viewport(opts.choices.length, 10 + (hasDetail ? DETAIL_ROWS + 1 : 0));
  let printed = 0;

  const sorted = () => [...selected].sort((a, b) => a - b);

  const draw = () => {
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + rows) offset = cursor - rows + 1;
    const lines = frame({ ...opts, cursor, selected: opts.multi ? selected : undefined, offset, rows, detailWidth });
    if (printed) process.stdout.write(`[${printed}A[0J`);
    process.stdout.write(lines.join("\n") + "\n");
    printed = lines.length;
  };

  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  enterRaw();

  draw();

  const watchdog = new AbortController();

  return await new Promise<PickResult<T>>((resolve) => {
    let done = false;
    const finish = (r: PickResult<T>) => {
      if (done) return;
      done = true;
      // Before anything else: whoever is watching stops now.
      watchdog.abort();
      stdin.off("data", onData);
      // Hand the terminal back the way a shell expects it: cooked, flowing,
      // no listener of ours left on it. Restoring the previous mode and
      // pausing was wrong on both counts — the next readline prompt got a
      // stdin that was still raw and no longer flowing, so nothing echoed and
      // nothing was accepted, and the terminal had to be killed to recover.
      leaveRaw();
      resolve(r);
    };

    const onData = (data: string) => {
      const k = decode(data);
      if (k.abort) {
        // Raw mode swallows the interrupt — the terminal driver hands Ctrl-C
        // over as a byte instead of a signal, so nothing above this ever
        // heard it. Put the terminal back and deliver it, which is what the
        // person pressing it asked for.
        // Deliberately never resolves: the caller would print "you chose X"
        // for whatever the cursor was on, which is not what happened. The
        // interrupt is on its way and every handler for it exits.
        watchdog.abort();
        stdin.off("data", onData);
        leaveRaw();
        process.kill(process.pid, "SIGINT");
        return;
      }
      const moved = () => {
        draw();
        if (!opts.multi) opts.onToggle?.([cursor]);
      };
      if (k.escape) return finish({ escaped: true });
      if (k.up) { cursor = step(cursor, -1); moved(); return; }
      if (k.down) { cursor = step(cursor, 1); moved(); return; }
      if (opts.multi && k.all) {
        const every = opts.choices.reduce((n, c) => (c.header ? n : n + 1), 0);
        if (selected.size === every) selected.clear();
        else opts.choices.forEach((c, i) => { if (!c.header) selected.add(i); });
        draw();
        opts.onToggle?.(sorted());
        return;
      }
      if (k.digit !== undefined) {
        // Numbers still work: muscle memory from the version this replaces,
        // and the only way to reach item 12 in one keystroke.
        const i = k.digit === 0 ? 9 : k.digit - 1;
        if (i < opts.choices.length && !isHeader(i)) { cursor = i; moved(); }
        return;
      }
      if (opts.multi && k.space) {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        draw();
        opts.onToggle?.(sorted());
        return;
      }
      if (k.enter) {
        if (!opts.multi) return finish({ picked: [cursor] });
        return finish({ picked: sorted() });
      }
    };

    stdin.on("data", onData);

    if (opts.watch) {
      void opts
        .watch(watchdog.signal, (indexes) => {
          if (done) return;
          selected.clear();
          for (const i of indexes) if (i >= 0 && i < opts.choices.length) selected.add(i);
          if (!opts.multi && indexes.length) cursor = indexes[0];
          draw();
        })
        .then((v) => {
          if (v !== undefined) finish({ interrupted: v });
        })
        .catch(() => {
          /* aborted, which is the normal way out */
        });
    }
  });
}
