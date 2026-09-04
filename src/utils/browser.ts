/**
 * Can this machine put a page in front of the person using it?
 *
 * Nobody should have to tell a tool it is on a server. Asking the user to
 * pass a flag for it means asking them to know a word — "headless" — for a
 * situation the machine can read for itself, and to know it before anything
 * has gone wrong. The signals are unambiguous enough:
 *
 *   · a session that arrived over SSH has its browser at the other end of
 *     the connection; opening one here puts it on a screen nobody is at
 *   · a Linux box with no display server has no browser to open at all
 *   · CI has nobody watching by definition
 *
 * Being wrong is cheap in one direction and not the other. Deciding we
 * cannot open a browser when we could costs one printed URL. Deciding we
 * can when we cannot leaves a person watching a terminal that is waiting
 * for a click nobody will ever make.
 */
export function canOpenBrowser(): boolean {
  // An explicit answer always wins — scripts, containers, and anyone whose
  // setup we guessed wrong about.
  if (process.env.AISA_NO_BROWSER) return false;
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.SSH_CLIENT) return false;
  if (process.env.CI) return false;
  if (process.platform === "darwin" || process.platform === "win32") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
