import chalk from "chalk";

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
  digit?: number;
  all?: boolean;
}

function decode(data: string): Keys {
  return {
    up: data === "[A" || data === "k",
    down: data === "[B" || data === "j",
    space: data === " ",
    enter: data === "\r" || data === "\n",
    abort: data === "" || data === "",
    all: data === "a",
    digit: /^[0-9]$/.test(data) ? Number(data) : undefined,
  };
}

/** Room for the list, leaving the header and footer their lines. */
function viewport(total: number, reserved: number): number {
  const rows = process.stdout.rows || 24;
  return Math.max(3, Math.min(total, rows - reserved));
}

function truncate(text: string, width: number): string {
  // Measured in cells: a CJK glyph is two, so counting characters would let a
  // Chinese label wrap and break the redraw.
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠]/.test(ch) ? 2 : 1;
    if (w + cw > width) return out + "…";
    out += ch;
    w += cw;
  }
  return out;
}

interface RenderOptions {
  title: string;
  hint: string;
  choices: Choice[];
  cursor: number;
  selected?: Set<number>;
  offset: number;
  rows: number;
}

function frame(o: RenderOptions): string[] {
  const lines: string[] = [];
  const width = Math.min(process.stdout.columns || 80, 90) - 6;
  for (let i = o.offset; i < Math.min(o.offset + o.rows, o.choices.length); i++) {
    const c = o.choices[i];
    const here = i === o.cursor;
    const on = Boolean(o.selected?.has(i));
    // Four states, four looks. Before this, "where I am" and "what I picked"
    // were drawn the same way — a cyan bar for the cursor and a green tick
    // inside it — so on the row you were standing on there was no telling
    // whether it was ticked. Chosen is a filled green bar; the cursor alone
    // is an outline; the rest recede.
    const mark = o.selected ? (on ? "✓" : " ") : here ? "▶" : " ";
    const body = truncate(c.label, width - 20);
    const meta = c.meta ? "  " + truncate(c.meta, 18) : "";
    const row = ` ${mark} ${body}${meta} `;

    let painted: string;
    if (on && here) painted = chalk.bgGreen.black.bold(row);
    else if (on) painted = chalk.green.bold(row);
    else if (here) painted = chalk.bgWhite.black(row);
    else painted = " " + mark + " " + body + chalk.gray(meta) + " ";

    lines.push(chalk.gray("│") + painted);
  }
  if (o.choices.length > o.rows) {
    lines.push(chalk.gray(`│   ${o.offset + 1}–${Math.min(o.offset + o.rows, o.choices.length)} / ${o.choices.length}`));
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
  let cursor = opts.cursor ?? (opts.initial?.[0] ?? 0);
  let offset = 0;
  const rows = viewport(opts.choices.length, 10);
  let printed = 0;

  const sorted = () => [...selected].sort((a, b) => a - b);

  const draw = () => {
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + rows) offset = cursor - rows + 1;
    const lines = frame({ ...opts, cursor, selected: opts.multi ? selected : undefined, offset, rows });
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
      if (k.abort) return finish({ aborted: true });
      const moved = () => {
        draw();
        if (!opts.multi) opts.onToggle?.([cursor]);
      };
      if (k.up) { cursor = (cursor - 1 + opts.choices.length) % opts.choices.length; moved(); return; }
      if (k.down) { cursor = (cursor + 1) % opts.choices.length; moved(); return; }
      if (opts.multi && k.all) {
        if (selected.size === opts.choices.length) selected.clear();
        else opts.choices.forEach((_, i) => selected.add(i));
        draw();
        opts.onToggle?.(sorted());
        return;
      }
      if (k.digit !== undefined) {
        // Numbers still work: muscle memory from the version this replaces,
        // and the only way to reach item 12 in one keystroke.
        const i = k.digit === 0 ? 9 : k.digit - 1;
        if (i < opts.choices.length) { cursor = i; moved(); }
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
