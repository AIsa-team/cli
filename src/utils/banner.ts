import chalk from "chalk";

/**
 * The two lines that open `aisa connect`.
 *
 * A banner is seen once with pleasure and then several hundred times, so the
 * question is not which one looks best the first time but which one is still
 * bearable the twentieth. That rules out the tall ones: six lines of block
 * letters push the thing a person actually came to read below the fold, every
 * single run.
 *
 * Two lines, 46 columns. AIsa in the brand orange, `connect` in grey beside
 * it — the same order of importance the page gives them. Half-block glyphs,
 * which every monospace font has, rather than a face that needs one.
 */
const AISA = ["▄▀█ █ █▀ ▄▀█", "█▀█ █ ▄█ █▀█"];
const CONNECT = ["█▀▀ █▀█ █▄░█ █▄░█ █▀▀ █▀▀ ▀█▀", "█▄▄ █▄█ █░▀█ █░▀█ ██▄ █▄▄ ░█░"];
/** Both halves plus the gap and the leading space. */
const WIDTH = 1 + 12 + 3 + 29;

/**
 * Print it, or don't — silence is the right answer more often than it looks.
 *
 * Nothing is drawn into a pipe: a banner in a log file or a CI transcript is
 * noise that someone has to scroll past, and the escape codes make it worse.
 * Nothing is drawn into a window too narrow to hold it either, because a
 * wrapped banner is a smear, which is worse than no banner at all.
 */
export function printBanner(): void {
  if (!process.stdout.isTTY) return;
  if (process.env.NO_COLOR || process.env.CI) return;
  if ((process.stdout.columns || 80) < WIDTH + 2) return;
  const orange = chalk.hex("#c2410c");
  const grey = chalk.hex("#a8a29e");
  console.log("");
  for (let i = 0; i < 2; i++) {
    console.log(" " + orange.bold(AISA[i]) + "   " + grey(CONNECT[i]));
  }
  console.log("");
}
