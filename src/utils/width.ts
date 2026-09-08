/**
 * How wide a string is on a terminal.
 *
 * There were three answers to this in the CLI and two of them were wrong, in
 * two different ways:
 *
 *  · `prompt.ts` counted characters, so a painted label was charged for its
 *    own escape sequences. `dim(" (recommended)")` is fourteen visible
 *    columns carried in twenty-three characters, and a four-row menu was cut
 *    to "Add AIsa beside it (recomme…" because of it.
 *  · `journal.ts` used `.length`, which is right for the English it happens
 *    to be given today and wrong the first time a Chinese string reaches it.
 *  · `connect-terminal.ts` had the only correct one, and only by never being
 *    handed anything painted.
 *
 * Two things are true of a terminal and neither is character count: a CJK
 * glyph occupies two columns in one character, and an escape sequence
 * occupies none in several. One implementation, used by all of them.
 */

/** SGR sequences — the only escapes this CLI emits. */
const ANSI = /\[[0-9;]*m/g;

/**
 * The ranges that take two columns.
 *
 * Hangul jamo, CJK radicals through the Yi syllabary (which contains the
 * ideographs themselves), Hangul syllables, compatibility ideographs,
 * vertical forms, and fullwidth ASCII.
 */
const WIDE =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** Columns the string occupies once printed. */
export function cells(text: string): number {
  let n = 0;
  for (const ch of stripAnsi(text)) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

/**
 * Cut to a column count, keeping colour intact.
 *
 * Escape sequences are copied through without being charged for, so a cut
 * never lands inside one — a half-written escape is not a shorter string,
 * it is a terminal printing `[1m` at the user.
 */
export function truncate(text: string, width: number): string {
  let out = "";
  let w = 0;
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      const end = text.indexOf("m", i);
      if (end !== -1) {
        out += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const cw = WIDE.test(ch) ? 2 : 1;
    if (w + cw > width) return out + "…";
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out;
}

/** Pad to a column count, counting what is printed rather than what is stored. */
export function padTo(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - cells(text)));
}
