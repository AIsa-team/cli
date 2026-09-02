import { describe, expect, it } from "vitest";
import {
  LANGS, resolveLang, t, STEP_AGENT, AGENT_ORDER, agentRank,
  AGENT_BADGE, AGENT_SIDE_TITLES, AGENT_NOTES, AGENT_HAVE_NOTES, installOffer,
} from "../src/commands/flow.js";
import { renderT2Page } from "../src/commands/connect-t2.js";
import type { LiveServer } from "../src/commands/mcp.js";
import type { ClientInfo } from "../src/commands/connect-shared.js";

/**
 * The flow definition, and the property that makes it worth having: the page
 * and the terminal say the same thing because they read the same field, not
 * because someone kept two copies in step.
 *
 * The last describe block is the one that matters. It renders the real page
 * and asserts that the sentences in it are the sentences in this file — so if
 * a future edit puts a string back into the markup, that test fails rather
 * than the divergence being noticed months later by a user.
 */

describe("resolveLang", () => {
  const NO_LOCALE = {} as NodeJS.ProcessEnv;

  it("prefers an explicit flag over everything", () => {
    expect(resolveLang("zh", "en", { LANG: "en_US.UTF-8" })).toBe("zh");
    expect(resolveLang("en", "zh", { LANG: "zh_CN.UTF-8" })).toBe("en");
  });

  it("then what was chosen and remembered", () => {
    expect(resolveLang(undefined, "zh", { LANG: "en_US.UTF-8" })).toBe("zh");
  });

  it("then the operating system, in any of the forms it writes Chinese", () => {
    for (const locale of ["zh_CN.UTF-8", "zh-Hans", "zh_TW.UTF-8", "zh"]) {
      expect(resolveLang(undefined, undefined, { LANG: locale }), locale).toBe("zh");
    }
    expect(resolveLang(undefined, undefined, { LC_ALL: "zh_CN.UTF-8" })).toBe("zh");
  });

  it("falls back to English rather than guessing", () => {
    expect(resolveLang(undefined, undefined, NO_LOCALE)).toBe("en");
    expect(resolveLang(undefined, undefined, { LANG: "ja_JP.UTF-8" })).toBe("en");
  });

  it("ignores a stored or passed value that is not a language we have", () => {
    expect(resolveLang("klingon", undefined, NO_LOCALE)).toBe("en");
    expect(resolveLang(undefined, "fr", NO_LOCALE)).toBe("en");
  });
});

describe("translations are complete", () => {
  /** A missing zh falls back to en, which reads as a bug rather than a
   *  language: half a page in each. Catch it here instead. */
  const texts = {
    "STEP_AGENT.title": STEP_AGENT.title,
    "STEP_AGENT.sub": STEP_AGENT.sub,
    "STEP_AGENT.question": STEP_AGENT.question,
    "STEP_AGENT.lede": STEP_AGENT.lede!,
    ...Object.fromEntries(Object.entries(AGENT_BADGE).map(([k, v]) => [`badge.${k}`, v])),
    ...Object.fromEntries(Object.entries(AGENT_SIDE_TITLES).map(([k, v]) => [`side.${k}`, v])),
    ...Object.fromEntries(Object.entries(AGENT_NOTES).map(([k, v]) => [`note.${k}`, v])),
    ...Object.fromEntries(Object.entries(AGENT_HAVE_NOTES).map(([k, v]) => [`have.${k}`, v])),
  };

  it.each(LANGS)("every string has a %s", (lang) => {
    for (const [name, text] of Object.entries(texts)) {
      expect(t(text, lang).trim(), `${name}.${lang}`).not.toBe("");
    }
  });

  it("zh is actually translated, not the English copied across", () => {
    for (const [name, text] of Object.entries(texts)) {
      // Badges carry a tick and side titles are short, but no long sentence
      // should be identical in both — that means someone pasted and moved on.
      if (text.en.length > 40) expect(text.zh, name).not.toBe(text.en);
    }
  });

  it("covers every agent the flow can offer", () => {
    for (const id of AGENT_ORDER) {
      expect(AGENT_NOTES[id], `AGENT_NOTES.${id}`).toBeDefined();
    }
  });

  it("names no agent that was removed from the client table", () => {
    // Windsurf was dropped 2026-08-25; a note for it would be dead copy that
    // still has to be translated and reviewed.
    expect(AGENT_NOTES.windsurf).toBeUndefined();
    expect(AGENT_HAVE_NOTES.windsurf).toBeUndefined();
  });
});

describe("agent order", () => {
  it("is stable, so a numbered menu means the same in both renderers", () => {
    expect(agentRank("claude-code")).toBeLessThan(agentRank("codex"));
    expect(agentRank("codex")).toBeLessThan(agentRank("vscode"));
    expect(agentRank("vscode")).toBeLessThan(agentRank("claude-ai"));
  });

  it("puts an unknown id last rather than first", () => {
    expect(agentRank("nethack")).toBeGreaterThan(agentRank("claude-ai"));
  });
});

describe("installOffer", () => {
  it("shows the exact command in either language", () => {
    for (const lang of LANGS) {
      expect(installOffer("npm install -g @openai/codex", lang)).toContain(
        "npm install -g @openai/codex"
      );
    }
  });
});

/**
 * The reason this file exists: one source, two renderers.
 */
describe("the page renders from the flow definition, not its own copy", () => {
  const servers: LiveServer[] = [
    { slug: "web-search", name: "AIsa Web Search", endpoint: "https://mcp.aisa.one/web-search/mcp", toolCount: 27, description: "Search.", category: "Search & Research" },
  ];
  const clients: ClientInfo[] = [
    { id: "claude-code", label: "Claude Code", kind: "cli", detected: true, detail: "2.1.241" },
    { id: "codex", label: "Codex", kind: "cli", detected: false, detail: "not on PATH", installable: true, command: "npm install -g @openai/codex" },
  ];
  const page = (lang?: "en" | "zh") =>
    renderT2Page(servers, clients, "t".repeat(32), true, true, "start", lang);

  it("takes the question and lede from STEP_AGENT", () => {
    const html = page("en");
    expect(html).toContain(STEP_AGENT.lede!.en);
    // The page italicises two words inside the question, so match around them.
    expect(html).toContain("Which agent should AIsa");
    expect(html).toContain("plug into");
  });

  it("takes the badges from AGENT_BADGE", () => {
    const html = page("en");
    expect(html).toContain(AGENT_BADGE.detected.en);
    expect(html).toContain(AGENT_BADGE.absent.en);
  });

  it("takes the side-column titles from AGENT_SIDE_TITLES", () => {
    const html = page("en");
    expect(html).toContain(AGENT_SIDE_TITLES.how.en);
    expect(html).toContain(AGENT_SIDE_TITLES.have.en);
  });

  it("renders Chinese throughout when asked, not just the headings", () => {
    const html = page("zh");
    expect(html).toContain(STEP_AGENT.question.zh);
    expect(html).toContain(STEP_AGENT.lede!.zh);
    expect(html).toContain(AGENT_BADGE.detected.zh);
    expect(html).toContain(AGENT_SIDE_TITLES.how.zh);
    // The per-agent notes are injected as page script data, so they are the
    // easiest thing to leave behind in English.
    expect(html).toContain(AGENT_NOTES["claude-code"].zh);
    expect(html).toContain(AGENT_HAVE_NOTES["claude-code"].zh);
  });

  it("leaves no English copy of a translated string on the Chinese page", () => {
    const html = page("zh");
    expect(html).not.toContain(STEP_AGENT.lede!.en);
    expect(html).not.toContain(AGENT_NOTES["claude-code"].en);
  });

  it("defaults to English when no language is given", () => {
    expect(page()).toContain(STEP_AGENT.lede!.en);
  });
});
