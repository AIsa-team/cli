/**
 * What `aisa connect` asks, in the order it asks it — as data.
 *
 * The page and the terminal are two renderers of this file, not two programs
 * that happen to agree. Before it existed they were the latter: every sentence
 * on the T2 page lived inside a template string (82% of that file is markup),
 * so the terminal carried a hand-written paraphrase of the same choices. Two
 * copies of the same wording drift, and nothing catches it — there is no test
 * that can compare a sentence in HTML against a sentence in a log line.
 *
 * So copy lives here, beside the structure it belongs to. A step that the page
 * renders as a card and the terminal renders as a numbered menu is still one
 * step, with one question and one set of options.
 *
 * ── Language ──────────────────────────────────────────────────────────────
 * Every user-facing string is a `Text`: `{ en, zh }`. This is a product
 * surface, not the machine-readable one — `aisa manifest`, MCP tool
 * descriptions and OpenAPI summaries stay English-only, per the workspace
 * convention, because those are read by agents everywhere. What a person sees
 * while choosing is a different audience.
 *
 * The chosen language is stored by the CLI (see config.ts), not in the
 * browser: the page is served by this process, and a language kept only in
 * localStorage would leave the terminal in English while the page is in
 * Chinese — the exact split this file exists to prevent.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 * Step 2 (Your agent) is here now. The remaining steps still render from
 * connect-t2.ts and are being moved one at a time, each behind the byte-exact
 * page snapshots in tests/connect-snapshot.test.ts.
 */

export const LANGS = ["en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

/** One string in every language it is offered in. */
export interface Text {
  en: string;
  zh: string;
}

export function t(text: Text, lang: Lang): string {
  return text[lang] ?? text.en;
}

/**
 * Resolve the language for this run: explicit flag, then what was chosen and
 * remembered, then the OS, then English.
 *
 * The OS check is deliberately loose — `zh_CN.UTF-8`, `zh-Hans`, `zh_TW` all
 * mean a reader who would rather not be handed English.
 */
export function resolveLang(
  flag?: string,
  stored?: string,
  env: NodeJS.ProcessEnv = process.env
): Lang {
  const known = (v?: string): Lang | undefined =>
    LANGS.includes(v as Lang) ? (v as Lang) : undefined;
  if (known(flag)) return known(flag)!;
  if (known(stored)) return known(stored)!;
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  if (/^zh/i.test(locale)) return "zh";
  return "en";
}

/** A choice within a step. `detail` is the sentence under the label. */
export interface FlowOption {
  id: string;
  label: Text;
  detail?: Text;
  /** Shown instead of `detail` when the thing is not installed. */
  absentDetail?: Text;
}

export interface FlowStep {
  id: string;
  n: number;
  title: Text;
  sub: Text;
  question: Text;
  lede?: Text;
}

// ── step 2: your agent ──────────────────────────────────────────────────────

export const STEP_AGENT: FlowStep = {
  id: "agent",
  n: 2,
  title: { en: "Your agent", zh: "你的 agent" },
  sub: { en: "Pick the tool to connect", zh: "选择要连接的工具" },
  question: {
    en: "Which agent should AIsa plug into?",
    zh: "AIsa 要接入哪个 agent?",
  },
  lede: {
    en: "One agent per run, so a problem is always easy to place. Detected tools are ready to connect; a missing one can be installed right here through its official installer.",
    zh: "一次只连一个 agent,出问题时永远知道该看哪里。已检测到的可以直接连接;没装的可以在这里用它官方的安装方式装上。",
  },
};

/**
 * Fixed card order, whatever is or is not installed: the terminal agents
 * first, then the editors, then the web targets. Order is part of the flow,
 * not of one renderer — a menu that renumbers itself between the page and the
 * terminal would make "pick 2" mean two different things.
 */
export const AGENT_ORDER = [
  "claude-code",
  "codex",
  "opencode",
  "vscode",
  "cursor",
  "claude-desktop",
  "claude-ai",
] as const;

export function agentRank(id: string): number {
  const i = (AGENT_ORDER as readonly string[]).indexOf(id);
  return i === -1 ? 99 : i;
}

/** Badges on an agent card. The terminal renders the same three states. */
export const AGENT_BADGE = {
  detected: { en: "✓ detected", zh: "✓ 已检测到" },
  absent: { en: "not installed", zh: "未安装" },
  web: { en: "web · no install", zh: "网页版 · 无需安装" },
  notFound: { en: "not found", zh: "未找到" },
  soon: { en: "soon", zh: "即将支持" },
} satisfies Record<string, Text>;

export const AGENT_SIDE_TITLES = {
  how: { en: "How it connects", zh: "它是怎么连上的" },
  have: { en: "Already have it set up?", zh: "已经配置过了怎么办?" },
} satisfies Record<string, Text>;

/** Offer to install a missing agent, with the exact command that will run. */
export function installOffer(command: string, lang: Lang): string {
  return lang === "zh"
    ? `安装<b>并</b>连接 — <code>${command}</code>`
    : `Install <b>and</b> connect it — <code>${command}</code>`;
}

/**
 * What connecting each agent actually does, in its own terms.
 *
 * These name the real mechanism — `claude mcp add`, a provider block in
 * config.toml — because the question a reader has at this step is "what are
 * you about to do to my machine", and the honest answer is the command.
 */
export const AGENT_NOTES: Record<string, Text> = {
  "claude-code": {
    en: "Servers are added with <code>claude mcp add</code> in user scope — the official mechanism, reversible with <code>claude mcp remove</code>. Models, if you choose to, are set through Claude Code's own settings file.",
    zh: "通过 <code>claude mcp add</code> 写入 user scope —— 这是官方机制,用 <code>claude mcp remove</code> 就能撤销。模型(如果你选择切换)走 Claude Code 自己的设置文件。",
  },
  codex: {
    en: "Servers are added with <code>codex mcp add</code>, Codex's own command. Models go in an <code>aisa</code> provider inside <code>~/.codex/config.toml</code> — only keys we wrote are ever touched.",
    zh: "通过 Codex 自己的 <code>codex mcp add</code> 写入。模型写成 <code>~/.codex/config.toml</code> 里的一个 <code>aisa</code> provider —— 只动我们自己写的那些键。",
  },
  opencode: {
    en: "Servers are added with <code>opencode mcp add</code>. Models become an extra <code>aisa</code> provider in <code>opencode.json</code>; pick <code>aisa/…</code> from its model list.",
    zh: "通过 <code>opencode mcp add</code> 写入。模型会成为 <code>opencode.json</code> 里额外的一个 <code>aisa</code> provider,在它的模型列表里选 <code>aisa/…</code> 即可。",
  },
  vscode: {
    en: "Nothing is done by hand. The AIsa servers go into VS Code's <code>mcp.json</code> (with your key, or VS Code signs in to them itself), and a small <b>AIsa extension</b> is installed that asks VS Code to store your key and add the models as a <b>Custom Endpoint</b> group named AIsa — beside Copilot's own, which stay. Inline completions keep using Copilot.",
    zh: "全程无需手动操作。AIsa 的 server 写进 VS Code 的 <code>mcp.json</code>(带上你的 key,或者由 VS Code 自己去登录),同时装一个很小的 <b>AIsa 扩展</b>,由它请 VS Code 保管你的 key 并把模型添加为名为 AIsa 的 <b>Custom Endpoint</b> 分组 —— 与 Copilot 自己的并存,不动它。行内补全仍然用 Copilot。",
  },
  cursor: {
    en: "One click per server: each becomes an <b>Add to Cursor</b> link on the last step. Cursor opens, shows you the exact entry, and writes it into its own MCP settings when you confirm. Models stay as they are — Cursor picks its own.",
    zh: "每个 server 一次点击:最后一步会给出 <b>Add to Cursor</b> 链接。Cursor 会打开、把确切的配置内容给你看,你确认后由它自己写进 MCP 设置。模型保持原样 —— Cursor 用它自己的。",
  },
  "claude-desktop": {
    en: "Claude Desktop's config file only takes MCP servers over stdio, so each AIsa server is written in as a small <code>mcp-remote</code> bridge carrying your key (plus the free <code>aisa-docs</code> server). The bridges live and die with the app — no background service, no open ports. Models cannot be changed: Claude Desktop runs Anthropic's own. Restart the app and the servers appear under its tools menu.",
    zh: "Claude Desktop 的配置文件只接受 stdio 形式的 MCP server,所以每个 AIsa server 都写成一个带你 key 的 <code>mcp-remote</code> 小桥接(外加免费的 <code>aisa-docs</code>)。桥接随 app 启停 —— 没有后台服务,不开端口。模型无法更改:Claude Desktop 跑的是 Anthropic 自家模型。重启 app 后就能在工具菜单里看到这些 server。",
  },
  "claude-ai": {
    en: "Nothing is installed. claude.ai takes remote MCP servers as <b>Connectors</b>: on the last step you get one URL per server with a Copy button, and add each under <b>Settings → Connectors → Add custom connector</b>, then press Connect — claude.ai runs the AIsa sign-in itself. Models cannot be changed: claude.ai runs Anthropic's own.",
    zh: "不安装任何东西。claude.ai 以 <b>Connectors</b> 的形式接受远程 MCP server:最后一步会给出每个 server 的 URL 和复制按钮,在 <b>Settings → Connectors → Add custom connector</b> 里逐个添加,然后点 Connect —— claude.ai 会自己跑 AIsa 的登录流程。模型无法更改:claude.ai 跑的是 Anthropic 自家模型。",
  },
};

/**
 * The answer to "will this break what I already have", per agent.
 *
 * Asked on this step rather than later because it is what decides whether
 * someone continues at all.
 */
export const AGENT_HAVE_NOTES: Record<string, Text> = {
  "claude-code": {
    en: "Nothing of yours is replaced. Your <code>claude</code> keeps its login, models and settings; the next step lets you add AIsa <b>beside</b> it as a separate <b><code>claude-aisa</code></b> command, or switch — your call.",
    zh: "你原有的东西一样都不会被替换。你的 <code>claude</code> 保留登录、模型和设置;下一步你可以选择把 AIsa 装在<b>旁边</b>(一个独立的 <b><code>claude-aisa</code></b> 命令),也可以直接切换 —— 你说了算。",
  },
  codex: {
    en: "Nothing of yours is replaced. Your <code>codex</code> keeps its login and config; the next step lets you add AIsa <b>beside</b> it as an <code>aisa</code> profile and a <b><code>codex-aisa</code></b> command, or switch — your call.",
    zh: "你原有的东西一样都不会被替换。你的 <code>codex</code> 保留登录和配置;下一步你可以选择把 AIsa 装在<b>旁边</b>(一个 <code>aisa</code> profile 加一个 <b><code>codex-aisa</code></b> 命令),也可以直接切换 —— 你说了算。",
  },
  opencode: {
    en: "Nothing of yours is replaced. Your default model stays; the next step can add AIsa as an extra <code>aisa/…</code> provider you pick from the model list, or switch — your call.",
    zh: "你原有的东西一样都不会被替换。默认模型保持不变;下一步可以把 AIsa 添加为额外的 <code>aisa/…</code> provider(在模型列表里选),也可以直接切换 —— 你说了算。",
  },
  "claude-desktop": {
    en: "Nothing of yours is replaced. Anything already in <code>claude_desktop_config.json</code> stays; AIsa's entries are added beside it under <code>aisa-*</code> names and removing them is deleting those entries.",
    zh: "你原有的东西一样都不会被替换。<code>claude_desktop_config.json</code> 里已有的内容保持原样;AIsa 的条目以 <code>aisa-*</code> 命名加在旁边,要移除就是删掉这些条目。",
  },
  "claude-ai": {
    en: "Nothing of yours is touched — the connectors live in your claude.ai account, beside any you already have, and can be removed there in one click.",
    zh: "完全不动你原有的东西 —— connector 存在你的 claude.ai 账户里,与你已有的并存,在那里一键就能移除。",
  },
  vscode: {
    en: "Nothing of yours is replaced. Other MCP servers and model groups in those two files stay; only the <code>aisa-*</code> entries and the AIsa group are ours, and removing them is deleting those entries.",
    zh: "你原有的东西一样都不会被替换。那两个文件里其他的 MCP server 和模型分组保持原样;只有 <code>aisa-*</code> 条目和 AIsa 那个分组是我们写的,要移除就是删掉它们。",
  },
  cursor: {
    en: "Nothing of yours is replaced. Cursor adds each AIsa server beside your existing MCP entries under <code>aisa-*</code> names, and you approve every one inside Cursor first.",
    zh: "你原有的东西一样都不会被替换。Cursor 会把每个 AIsa server 以 <code>aisa-*</code> 命名加在你已有的 MCP 条目旁边,而且每一个都要你在 Cursor 里先确认。",
  },
};
