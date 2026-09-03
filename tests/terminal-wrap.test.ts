import { describe, expect, it } from "vitest";
import { wrap, displayWidth, plain } from "../src/commands/connect-terminal.js";

/**
 * Wrapping for a terminal that has to render Chinese.
 *
 * Splitting on spaces is enough for English and wrong for Chinese, which has
 * none: a whole sentence arrives as a single "word" and the line runs past the
 * margin. Seen on the welcome step, where a paragraph overflowed by half a
 * line. Width is also cells, not characters — a CJK glyph occupies two.
 */

describe("displayWidth", () => {
  it("counts a CJK glyph as two cells", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("中文")).toBe(4);
    expect(displayWidth("a中")).toBe(3);
  });

  it("counts full-width punctuation as two", () => {
    expect(displayWidth("。")).toBe(2);
    expect(displayWidth("、")).toBe(2);
  });
});

describe("wrap", () => {
  const within = (lines: string[], width: number) =>
    lines.every((l) => displayWidth(l) <= width);

  it("keeps English inside the width", () => {
    const lines = wrap("the quick brown fox jumps over the lazy dog again and again", 20);
    expect(within(lines, 20)).toBe(true);
    expect(lines.join(" ")).toContain("quick brown");
  });

  it("breaks a Chinese run that has no spaces to break on", () => {
    const zh = "全新安装还没有模型后端这会写入代理自己的提供方设置让它一上来就能工作";
    const lines = wrap(zh, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(within(lines, 20), lines.map(displayWidth).join(",")).toBe(true);
  });

  it("loses no characters when it breaks", () => {
    const zh = "市场分析与拓展调研金融数据社交媒体信号B2B获客";
    expect(wrap(zh, 12).join("")).toBe(zh);
  });

  it("handles mixed script, which is what our copy actually is", () => {
    const mixed = "AIsa 是 AI agent 的能力层:一个账户、一把 key,让你的编程 agent 既能用上最好的模型";
    const lines = wrap(mixed, 30);
    expect(within(lines, 30), lines.map(displayWidth).join(",")).toBe(true);
  });

  it("returns nothing for an empty string rather than one empty line", () => {
    expect(wrap("", 20)).toEqual([]);
  });
});

describe("plain", () => {
  it("strips the markup the page needs and the terminal cannot show", () => {
    expect(plain("Run <code>codex-aisa</code> whenever")).toBe("Run codex-aisa whenever");
    expect(plain("one<br>two")).toBe("one two");
  });

  it("unescapes entities so they do not reach the screen raw", () => {
    expect(plain("a &amp; b")).toBe("a & b");
  });
});
