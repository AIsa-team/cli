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

const MARKS: Record<Mark, { icon: string; paint: (s: string) => string }> = {
  step: { icon: "▸", paint: (s) => chalk.bold(s) },
  ok: { icon: "✅", paint: (s) => s },
  warn: { icon: "⚠️ ", paint: (s) => chalk.yellow(s) },
  fail: { icon: "❌", paint: (s) => chalk.red(s) },
  info: { icon: "ℹ️ ", paint: (s) => s },
  write: { icon: "📝", paint: (s) => s },
  cmd: { icon: "⌨️ ", paint: (s) => s },
  choice: { icon: "•", paint: (s) => s },
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
    const plain = detail ? `${text} — ${detail}` : text;
    this.emit(
      m.icon,
      `${m.icon} ${m.paint(text)}${detail ? chalk.gray(` — ${detail}`) : ""}`,
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

  /** Log-only: detail worth having in a bug report, noise in a terminal. */
  record(text: string): void {
    this.write(`   · ${text}`);
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
