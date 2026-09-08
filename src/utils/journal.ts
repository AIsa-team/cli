import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";

/**
 * The console transcript of a connect run, and its log file.
 *
 * Two audiences, one stream. In the terminal a user should be able to read
 * back what they chose in the browser, what was checked, what was written
 * where, and which commands they now have — the page is transient, the
 * scrollback is not, and someone who reads it has learned how to do the same
 * thing by hand next time. On disk the same lines (without colour) go to
 * ~/.aisa/logs/connect-<stamp>.log, so a user hitting trouble can send one
 * file that says exactly what happened. Configuration runs are rare, so the
 * logs stay small; the last few are kept and older ones dropped.
 */

const KEEP_LOGS = 20;

export type Mark = "step" | "ok" | "warn" | "fail" | "info" | "write" | "cmd" | "choice";

/**
 * One column of structure on the left, one glyph of outcome on the right.
 *
 * Every reporting line used to open with its own status emoji — ✅ ⚠️ ❌ ℹ️ —
 * four different shapes in the first column, which is the column the eye uses
 * to find the shape of the section. The result was that the *structure* was
 * unreadable: you could not see at a glance that five lines are one list,
 * because no two of them started the same way.
 *
 * So the left column says "here is a line" and nothing else, and the outcome
 * moves to the end where it belongs — you read what happened, then whether it
 * worked. Lines with no outcome to report simply end.
 *
 * A plain bullet, the same one "What you chose" already used. An arrow was
 * tried here first and read as clutter: it points, and there is nothing for
 * it to point at when every line in the log starts with one.
 *
 * `step` keeps its own mark: a heading is not a result, and giving it the
 * same opener would say it was.
 *
 * Every icon is padded to two columns. ✅ was two wide and ▸ was one, so the
 * text in a section of headings started one column left of the text in a
 * section of results — a misalignment nobody could name but everybody saw.
 */
const MARKS: Record<Mark, { icon: string; paint: (s: string) => string; tail?: string; tailPlain?: string }> = {
  step: { icon: "▸ ", paint: (s) => chalk.bold(s) },
  ok: { icon: "• ", paint: (s) => s, tail: chalk.green("✓"), tailPlain: "✓" },
  warn: { icon: "• ", paint: (s) => chalk.yellow(s), tail: chalk.yellow("⚠"), tailPlain: "⚠" },
  fail: { icon: "• ", paint: (s) => chalk.red(s), tail: chalk.red("✗"), tailPlain: "✗" },
  info: { icon: "• ", paint: (s) => s },
  // No tail: the whole "What changed on this machine" section is things that
  // happened, and a tick on every line of it would say once per line what the
  // heading already said.
  write: { icon: "• ", paint: (s) => s },
  cmd: { icon: "⌨️ ", paint: (s) => s },
  choice: { icon: "• ", paint: (s) => s },
};

export class Journal {
  private file: string | null = null;

  constructor(private readonly quiet = false) {
    try {
      const dir = join(homedir(), ".aisa", "logs");
      mkdirSync(dir, { recursive: true });
      // Local time in the name, like the lines inside: a user reading the
      // directory should recognise "the run I did after lunch".
      const d = new Date();
      const two = (n: number) => String(n).padStart(2, "0");
      const stamp =
        `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}` +
        `-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
      this.file = join(dir, `connect-${stamp}.log`);
      this.prune(dir);
    } catch {
      this.file = null; // a log we cannot write is a feature we do not get
    }
  }

  /** Keep the newest few runs; a config log is small but not eternal. */
  private prune(dir: string): void {
    try {
      const logs = readdirSync(dir)
        .filter((f) => f.startsWith("connect-") && f.endsWith(".log"))
        .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const old of logs.slice(KEEP_LOGS)) unlinkSync(join(dir, old.f));
    } catch {
      /* pruning is a courtesy */
    }
  }

  get path(): string | null {
    return this.file;
  }

  /** A section heading — the phases of a run, in the order they happen. */
  section(title: string): void {
    this.emit("", `\n${chalk.bold.underline(title)}`, `\n== ${title}`);
  }

  line(mark: Mark, text: string, detail?: string): void {
    const m = MARKS[mark];
    const plain = (detail ? `${text} — ${detail}` : text) + (m.tailPlain ? ` ${m.tailPlain}` : "");
    this.emit(
      m.icon,
      `${m.icon} ${m.paint(text)}${detail ? chalk.gray(` — ${detail}`) : ""}${m.tail ? ` ${m.tail}` : ""}`,
      `${m.icon} ${plain}`
    );
  }

  /** An indented continuation under the previous line. */
  note(text: string): void {
    this.emit("", chalk.gray(`   ${text}`), `   ${text}`);
  }

  /** A command the user can copy and run later. */
  command(cmd: string, why?: string): void {
    this.emit(
      "",
      `   ${chalk.cyan(cmd)}${why ? chalk.gray(`   ${why}`) : ""}`,
      `   $ ${cmd}${why ? `   # ${why}` : ""}`
    );
  }

  /**
   * A ruled line on its own, for a moment that deserves separating from
   * whatever an agent session just left on the screen.
   */
  rule(): void {
    const line = "\u2500".repeat(70);
    this.emit("", `\n${chalk.gray(line)}`, `\n${line}`);
  }

  /**
   * The last thing a run says. Everything above is what happened; these are
   * the commands worth remembering, so they get a rule above them, an arrow
   * each and the brightest ink on the screen — a reader who scrolled away
   * and came back should land on them. One entry is the common case; a
   * fresh install or a new wrapper command earns a second line above the
   * standing "run this again" one, most useful first.
     *
   * A blank line closes it, so the shell prompt that follows is not stuck to
   * the last thing we asked the reader to remember.
   */
  encore(items: Array<{ cmd: string; why: string }>): void {
    const width = Math.min(70, Math.max(...items.map((i) => i.cmd.length + i.why.length + 8)));
    const rule = "─".repeat(width);
    this.emit("", `\n${chalk.gray(rule)}`, `\n${rule}`);
    for (const { cmd, why } of items) {
      this.emit(
        "👉",
        `👉 ${chalk.bold.cyan(cmd)}  ${chalk.bold(why)}`,
        `👉 ${cmd}  ${why}`
      );
    }
    this.emit("", "", "");
  }

  /**
   * Log-only: detail worth having in a bug report, noise in a terminal.
   *
   * Indented past the line above rather than level with it. At three spaces
   * it started in the same column as its parent's text, which reads as the
   * next item in a list rather than as detail belonging to the one before —
   * and once it is properly indented the bullet has nothing left to do.
   */
  record(text: string): void {
    this.write(`      ${text}`);
  }

  private emit(_icon: string, pretty: string, plain: string): void {
    if (!this.quiet) console.log(pretty);
    this.write(plain);
  }

  private write(plain: string): void {
    if (!this.file) return;
    try {
      const t = new Date().toTimeString().slice(0, 8);
      appendFileSync(this.file, `${t} ${plain}\n`, "utf-8");
    } catch {
      this.file = null;
    }
  }
}
