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
/** Fill {name} placeholders. Keeps punctuation inside the translated string. */
export function fill(text: Text, lang: Lang, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.split(`{${k}}`).join(String(v)),
    t(text, lang)
  );
}

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

// ── the rail: every step's name ─────────────────────────────────────────────

export const STEP_TITLES: Array<{ n: number; title: Text; sub: Text }> = [
  { n: 1, title: { en: "Welcome", zh: "开始" },
    sub: { en: "What you are about to get", zh: "你将得到什么" } },
  { n: 2, title: STEP_AGENT.title, sub: STEP_AGENT.sub },
  { n: 3, title: { en: "Models", zh: "模型" },
    sub: { en: "What it runs on", zh: "它用什么模型跑" } },
  { n: 4, title: { en: "Capabilities", zh: "能力" },
    sub: { en: "Live data for your agent", zh: "给 agent 的实时数据" } },
  { n: 5, title: { en: "Install", zh: "安装" },
    sub: { en: "Sign in and wire it up", zh: "登录并接线" } },
  { n: 6, title: { en: "Done", zh: "完成" },
    sub: { en: "Try it now", zh: "现在就试试" } },
];

// ── step 1: welcome ─────────────────────────────────────────────────────────

export const STEP_WELCOME = {
  h1: {
    en: "One connection. Every major model, live data and skills — inside the agent you already use.",
    zh: "一次连接,把主流大模型、实时数据和技能,装进你已经在用的 agent 里。",
  },
  lede: {
    en: "AIsa is the capability layer for AI agents: one account, one key, and your coding agent can reach the best models and the real world. Setting it up takes about a minute and nothing here is irreversible.",
    zh: "AIsa 是 AI agent 的能力层:一个账户、一把 key,让你的编程 agent 既能用上最好的模型,也能接触真实世界的数据。整个过程大约一分钟,而且没有一步是不可撤销的。",
  },
  tiles: [
    {
      h3: { en: "All the well-known LLM models, one key, lower prices",
            zh: "所有知名大模型,一把 key,更低的价格" },
      p: { en: "Claude, GPT, Gemini, DeepSeek, Kimi, GLM, Qwen, Grok — all behind one endpoint, well below going direct. Switch between them with a single setting, no re-configuring.",
           zh: "Claude、GPT、Gemini、DeepSeek、Kimi、GLM、Qwen、Grok —— 全部在同一个接入点后面,价格明显低于直接购买。改一个设置就能切换,不用重新配置。" },
    },
    {
      h3: { en: "Rich, advanced tools your agent can act on",
            zh: "丰富、先进,而且 agent 真能调用的工具" },
      p: { en: "Market analysis and expansion research, finance data, social media signals, B2B prospecting — a wide network of officially licensed commercial APIs, integrated and refined by AIsa into MCP tools your agent can use out of the box.",
           zh: "市场分析与拓展调研、金融数据、社交媒体信号、B2B 获客 —— 背后是一大批正式授权的商业 API,由 AIsa 集成打磨成开箱即用的 MCP 工具。" },
    },
    {
      h3: { en: "Agent skills, ready to run", zh: "开箱即用的 agent 技能" },
      p: { en: "A public catalogue of skills that teach your agent how to use each capability well — install with <code>aisa skills</code>, no prompt engineering needed.",
           zh: "一个公开的技能目录,教你的 agent 怎么把每项能力用好 —— 用 <code>aisa skills</code> 安装,不需要自己调提示词。" },
    },
    {
      h3: { en: "MCP the friendly way", zh: "让 MCP 变简单" },
      p: { en: "One sign-in in your browser, zero keys to paste, every entry written through your agent's own official command. Remove it all just as easily.",
           zh: "浏览器里登录一次,不用粘贴任何 key,每一条配置都通过 agent 自己的官方命令写入。要移除同样简单。" },
    },
  ],
} satisfies { h1: Text; lede: Text; tiles: Array<{ h3: Text; p: Text }> };

// ── step 3: models ──────────────────────────────────────────────────────────

export const STEP_MODELS = {
  h1: { en: "Every major model, one account — and switching is a one-liner",
        zh: "所有主流模型,一个账户 —— 切换只要改一行" },
  lede: {
    en: "Whatever you decide below, this is what sits behind your AIsa key. No separate accounts, no separate billing, no re-wiring when a better model ships next month.",
    zh: "无论你在下面怎么选,这些都在你的 AIsa key 后面。不用开多个账户、不用分开付费,下个月出了更好的模型也不用重新接线。",
  },
  callout: {
    en: "<b>Switching is the whole point.</b> One key, one endpoint: change the model name and you are on a different lab's best model — Claude today, DeepSeek for the cheap batch job tonight, GPT-5.5 tomorrow. No new sign-ups, no new config, no juggling keys. ",
    zh: "<b>能随时切换才是重点。</b>一把 key、一个接入点:改个模型名字,你就用上了另一家的旗舰模型 —— 今天 Claude,晚上跑批量任务换便宜的 DeepSeek,明天 GPT-5.5。不用重新注册、不用改配置、不用管理一堆 key。 ",
  },
  rerun: {
    en: "Change the default any time — just run <b><code>aisa connect</code></b> again.",
    zh: "默认模型随时可改 —— 再跑一次 <b><code>aisa connect</code></b> 就行。",
  },
  h2Prefix: { en: "How should ", zh: "要让 " },
  h2Suffix: { en: " use them?", zh: " 怎么用这些模型?" },
  yourAgent: { en: "your agent", zh: "你的 agent" },
  recommended: { en: "recommended", zh: "推荐" },
  freshSwitch: {
    name: { en: "Run it on AIsa models", zh: "就用 AIsa 的模型跑" },
    brief: { en: "A fresh install has no model backend yet. This writes the agent's own provider settings so it starts on <b id=\"mModel\"></b> through AIsa — reversible.",
             zh: "全新安装还没有模型后端。这会写入 agent 自己的 provider 设置,让它一上来就通过 AIsa 使用 <b id=\"mModel\"></b> —— 可撤销。" },
  },
  notNow: {
    name: { en: "Not now", zh: "暂时不用" },
    briefFresh: { en: "Install it without a model. It will not answer a prompt until you configure a provider by hand.",
                  zh: "只安装,不配模型。在你手动配好 provider 之前,它无法回答任何问题。" },
    briefDetected: { en: "Leave models exactly as they are; only the MCP tools are added.",
                     zh: "模型保持原样,只添加 MCP 工具。" },
  },
  backup: {
    name: { en: "Add AIsa beside it", zh: "把 AIsa 装在旁边" },
  },
  switchIt: {
    name: { en: "Switch it to AIsa", zh: "切换到 AIsa" },
    brief: { en: "Points this agent's model traffic at AIsa (<b id=\"mModel2\"></b>). Writes the agent's own provider settings and nothing else — reversible.",
             zh: "把这个 agent 的模型流量指向 AIsa(<b id=\"mModel2\"></b>)。只写 agent 自己的 provider 设置,别的都不动 —— 可撤销。" },
  },
  warn: {
    head: { en: "⚠︎ Installing without a model backend", zh: "⚠︎ 安装后将没有模型后端" },
    body: { en: "A fresh install <b>cannot answer a single prompt</b> until you configure a provider by hand. Turn on AIsa models and it leaves here ready to work.",
            zh: "全新安装在你手动配好 provider 之前<b>一个问题都答不了</b>。打开 AIsa 模型,它离开这里时就能直接干活。" },
    fix: { en: "Use AIsa models →", zh: "使用 AIsa 模型 →" },
  },
};

/** Why the Models step has nothing to offer a file-configured client. */
export const FILE_MODEL_NOTE: Record<string, Text> = {
  "claude-desktop": {
    en: "<b>Claude Desktop runs on Anthropic's own models</b>, and AIsa cannot stand in for them — so nothing changes here. You still get every model above through the coding agents on the same AIsa account; Claude Desktop gets the MCP tools.",
    zh: "<b>Claude Desktop 跑的是 Anthropic 自家的模型</b>,AIsa 无法替代它们 —— 所以这一步不做任何改动。上面那些模型你仍然可以在同一个 AIsa 账户下,通过编程 agent 使用;Claude Desktop 这边拿到的是 MCP 工具。",
  },
  "claude-ai": {
    en: "<b>claude.ai runs on Anthropic's own models</b>, and AIsa cannot stand in for them — so nothing changes here. You still get every model above through the coding agents (Claude Code, Codex, opencode) on the same AIsa account; claude.ai gets the MCP connectors.",
    zh: "<b>claude.ai 跑的是 Anthropic 自家的模型</b>,AIsa 无法替代它们 —— 所以这一步不做任何改动。上面那些模型你仍然可以在同一个 AIsa 账户下,通过编程 agent(Claude Code、Codex、opencode)使用;claude.ai 这边拿到的是 MCP connector。",
  },
  cursor: {
    en: "<b>Cursor picks its models inside the app</b>, so nothing changes here — only the MCP servers are added.",
    zh: "<b>Cursor 在它自己的应用里选模型</b>,所以这一步不做改动 —— 只添加 MCP server。",
  },
};

/** Backup-mode consent copy, per client — the same contract T1 shows. */
export const BACKUP_COPY: Record<string, Text> = {
  "claude-code": {
    en: "Installs one small command, <b><code>claude-aisa</code></b>, next to your other tools. Your original <b><code>claude</code></b> keeps its login, models and settings <b>exactly as they are</b>.<br>You can use the newly added <b><code>claude-aisa</code></b> whenever you want AIsa's models at lower prices. Delete that one file to remove it.",
    zh: "在你其他工具旁边装一个很小的命令 <b><code>claude-aisa</code></b>。你原来的 <b><code>claude</code></b> 的登录、模型和设置<b>原封不动</b>。<br>想用 AIsa 的低价模型时,就用新加的 <b><code>claude-aisa</code></b>。删掉那一个文件就等于移除。",
  },
  codex: {
    en: "Adds an <b>aisa profile</b> inside Codex's own config and a <b><code>codex-aisa</code></b> command. Your default Codex is <b>untouched</b>.<br>You can use the newly added <b><code>codex-aisa</code></b> (or <code>codex --profile aisa</code>) whenever you want AIsa's models; it applies to that session only.",
    zh: "在 Codex 自己的配置里加一个 <b>aisa profile</b>,再加一个 <b><code>codex-aisa</code></b> 命令。你默认的 Codex <b>完全不动</b>。<br>想用 AIsa 的模型时,就用新加的 <b><code>codex-aisa</code></b>(或 <code>codex --profile aisa</code>);它只对那一次会话生效。",
  },
  vscode: {
    en: "Adds a <b>Custom Endpoint</b> group named <b>AIsa</b> to VS Code's chat models — Claude, GPT, DeepSeek, Kimi, GLM, Qwen — beside Copilot's own. Your Copilot setup is <b>untouched</b>.<br>A small <b>AIsa extension</b> is installed so VS Code stores your key itself — nothing to paste. Then pick any AIsa model from the chat model picker; inline completions stay on Copilot.",
    zh: "在 VS Code 的聊天模型里加一个名为 <b>AIsa</b> 的 <b>Custom Endpoint</b> 分组 —— Claude、GPT、DeepSeek、Kimi、GLM、Qwen —— 与 Copilot 自己的并存。你的 Copilot 配置<b>完全不动</b>。<br>会装一个很小的 <b>AIsa 扩展</b>,由 VS Code 自己保管你的 key —— 不用粘贴任何东西。之后在聊天模型选择器里挑任意 AIsa 模型即可;行内补全仍然走 Copilot。",
  },
  opencode: {
    en: "Adds AIsa as an <b>extra provider</b> in opencode's config. Your default model is <b>untouched</b>.<br>You can pick the newly added <code>aisa/…</code> models from opencode's model list whenever you want them.",
    zh: "在 opencode 的配置里把 AIsa 添加为<b>额外的 provider</b>。你的默认模型<b>完全不动</b>。<br>想用的时候,在 opencode 的模型列表里选新加的 <code>aisa/…</code> 就行。",
  },
};

// ── step 4: capabilities ────────────────────────────────────────────────────

export const STEP_CAPS = {
  h1: { en: "What should your agent be able to reach?", zh: "你的 agent 需要够得着什么?" },
  ledeTail: {
    en: "Open an area to pick the servers inside it. Everything here is live production data with licensed sources; you can add more later with one more <code>aisa connect</code>.",
    zh: "点开一个领域来挑里面的 server。这里全都是有授权来源的生产环境实时数据;之后再跑一次 <code>aisa connect</code> 就能加更多。",
  },
  pickArea: { en: "Pick an area above", zh: "先在上面选一个领域" },
  selectAll: { en: "Select all in this area", zh: "全选这个领域" },
  /**
   * The counts sentence as one string, because punctuation is not shared
   * between languages: joining "N", "areas", ", " in code produced
   * "2 个领域, 2 个 server, 48 个工具." — Chinese text with ASCII commas and a
   * full stop. Whatever varies goes in as a placeholder instead.
   */
  counts: {
    en: "{areas} areas, {servers} servers, {tools} tools.",
    zh: "{areas} 个领域、{servers} 个 server、{tools} 个工具。",
  },
  /** Category tile meta: "3 servers · 47 tools". */
  tileMeta: {
    en: "{n} {noun} · {tools} tools",
    zh: "{n} 个 {noun} · {tools} 个工具",
  },
  serversWord: { en: "servers", zh: "server" },
  serverWord: { en: "server", zh: "server" },
};

/** Shown for a file-configured client that has no note of its own. */
export const FILE_MODEL_FALLBACK: Text = {
  en: "This client picks its own models inside the app, so nothing is changed here — only the MCP servers are added.",
  zh: "这个客户端在它自己的应用里选模型,所以这一步不做改动 —— 只添加 MCP server。",
};

export const CATEGORY_BLURB: Record<string, Text> = {
  "Search & Research": {
    en: "Ranked web results with page text already extracted, plus YouTube.",
    zh: "带排序的网页搜索结果,正文已经抽好,另有 YouTube。",
  },
  Finance: {
    en: "US equities, crypto, prediction markets and what X is saying about a ticker.",
    zh: "美股、加密货币、预测市场,以及 X 上关于某只票的讨论。",
  },
  Social: {
    en: "Public X/Twitter, Reddit, Instagram and Pinterest — profiles, posts, engagement.",
    zh: "公开的 X/Twitter、Reddit、Instagram 和 Pinterest —— 资料、帖子、互动数据。",
  },
  Sales: {
    en: "Apollo B2B data — enrich people and companies, find prospects.",
    zh: "Apollo 的 B2B 数据 —— 补全人和公司信息、找潜在客户。",
  },
};

// ── step 5: install ─────────────────────────────────────────────────────────

export const STEP_INSTALL = {
  h1: { en: "Ready to connect", zh: "准备接线" },
  lede: {
    en: "Here is everything that happens, in order. It starts on its own; each step reports as it finishes, and your results open on the last step.",
    zh: "下面是将要发生的全部事情,按顺序列出。它会自动开始;每一步完成后都会汇报,结果会在最后一步打开。",
  },
  authKeyed: {
    en: "Your configured AIsa API key is written into each entry — <b>no sign-in needed</b>.",
    zh: "你已配置的 AIsa API key 会写进每一条配置 —— <b>无需登录</b>。",
  },
  authFresh: {
    en: "<b>One sign-in, nothing to paste.</b> Your browser opens the AIsa approval once; it issues a long-lived key for this machine, and every server and model is configured with it.",
    zh: "<b>登录一次,不用粘贴任何东西。</b>浏览器会打开一次 AIsa 授权页;它会为这台机器签发一把长期有效的 key,所有 server 和模型都用它来配置。",
  },
};

// ── step 6: done ────────────────────────────────────────────────────────────

export const STEP_DONE = {
  eyebrow: { en: "Step 6 of 6", zh: "第 6 步 / 共 6 步" },
  h1: { en: "Almost there…", zh: "就快好了…" },
  lede: { en: "The results appear here as soon as the run finishes.", zh: "运行一结束,结果就会显示在这里。" },
};

// ── strings the page script needs at runtime ────────────────────────────────
// Resolved to the current language and injected as a single object, because
// the browser has no access to this file. Same source, one hop later.

export const RUNTIME_COPY = {
  nothingSelected: {
    en: "Nothing selected yet — pick at least one server.",
    zh: "还没有选择 —— 至少选一个 server。",
  },
  planBackup: {
    "claude-code": { en: "Install the claude-aisa command", zh: "安装 claude-aisa 命令" },
    codex: { en: "Add the aisa profile and codex-aisa", zh: "添加 aisa profile 和 codex-aisa" },
    vscode: { en: "Add AIsa models to VS Code chat", zh: "把 AIsa 模型加进 VS Code 聊天" },
    other: { en: "Add AIsa as a backup provider", zh: "把 AIsa 添加为备用 provider" },
  },
  planBackupNote: {
    en: "your current setup stays untouched",
    zh: "你现有的配置原封不动",
  },
  ledeFailed: {
    en: "Some steps did not complete — the details are in the list; your results page explains how to retry.",
    zh: "有些步骤没有完成 —— 明细在上面的列表里,结果页会说明怎么重试。",
  },
  ledeAllRan: {
    en: "Everything ran. Your results, balance and try-it-now prompts are on the last step.",
    zh: "全部执行完毕。结果、余额和可以直接试的提示语都在最后一步。",
  },
  backupIntact: { en: "Your usual setup is untouched.", zh: "你平时用的配置原封不动。" },
  backupOpencode: {
    en: "Pick <code>aisa/…</code> from opencode's model list whenever you want AIsa.",
    zh: "想用 AIsa 的时候,在 opencode 的模型列表里选 <code>aisa/…</code> 即可。",
  },
  backupBin: {
    en: "Run <code>{bin}</code> whenever you want AIsa's models; delete that one file to remove it.",
    zh: "想用 AIsa 的模型时就跑 <code>{bin}</code>;删掉那一个文件就等于移除。",
  },
  noKeyStored: {
    en: "No key stored here — run <code>aisa login</code>, then copy it from <code>~/.aisa/key</code>.",
    zh: "本机没有存 key —— 先跑 <code>aisa login</code>,再从 <code>~/.aisa/key</code> 复制。",
  },
  cannotStartApp: {
    en: "Could not start {name} — open it from your Applications folder.",
    zh: "无法启动 {name} —— 请从应用程序文件夹里手动打开。",
  },
  cannotOpenTerminal: {
    en: "Could not open a terminal — just run <code>{bin}</code> in any terminal.",
    zh: "无法打开终端 —— 在任意终端里跑 <code>{bin}</code> 即可。",
  },
} as const;

/** Flatten RUNTIME_COPY to plain strings for the page script. */
export function runtimeCopy(lang: Lang): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (v && typeof v === "object" && "en" in v && "zh" in v) return t(v as Text, lang);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(RUNTIME_COPY) as Record<string, unknown>;
}
