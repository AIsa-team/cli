import { MCP_DEFAULT_SLUGS } from "../constants.js";
import { INSTALLERS } from "./install.js";
import { defaultModelsFor } from "./llm-config.js";
import { stripped, type LiveServer } from "./mcp.js";
import { BRAND_LOGOS } from "./brand-logos.js";
import {
  STEP_AGENT, AGENT_ORDER, agentRank, AGENT_BADGE, AGENT_SIDE_TITLES,
  AGENT_NOTES, AGENT_HAVE_NOTES, installOffer, t, fill, type Lang, LANGS, LANG_LABEL, NAV,
  STEP_TITLES, STEP_WELCOME, STEP_MODELS, STEP_CAPS, STEP_INSTALL, STEP_DONE,
  FILE_MODEL_NOTE, FILE_MODEL_FALLBACK, BACKUP_COPY, CATEGORY_BLURB, runtimeCopy, NEXT_WORD, SUPERSEDED,
} from "./flow.js";
import {
  RED,
  RED_CTA,
  INK,
  PAPER,
  I,
  LOGO,
  CATEGORY_ICON,
  EXAMPLES,
  CLIENT_LOGOS,
  CODEX_FACE,
  CLAUDE_BOT,
  OPENCODE_MARK,
  type ClientInfo,
} from "./connect-shared.js";
import { AISA_PROVIDER_ID } from "../constants.js";
import { VSCODE_MODELS } from "./vscode.js";

/**
 * T2 — the guided six-step connect flow.
 *
 * One page, six panes, a narrow step rail on the left and the current step
 * filling the rest of the screen. The shape is borrowed from the onboarding
 * flows that feel effortless (Sapiom's six-step rail was the reference): the
 * rail says where you are, the main area has room to actually explain the
 * step instead of cramming everything into one sidebar.
 *
 *   1 Welcome        what you are about to get
 *   2 Your agent     which tool to connect (install it if missing)
 *   3 Models         which models it runs on, and how easy it is to switch
 *   4 Capabilities   live data — a grid of capability areas, servers inside
 *   5 Install        sign in, install, wire up — animated, one tick at a time
 *   6 Done           congratulations, recap, balance, launch, try-it-now
 *
 * The install tab parks on step 5 and the success tab the process opens lands
 * on step 6; both are this same page, hydrated from GET /status, so from
 * either tab every other step remains one click away. Steps 1–4 turn
 * read-only once the run has started.
 *
 * The T1 flow (renderPage / renderDone in connect.ts) is untouched; the
 * server picks a template per run and both share the same endpoints.
 */

/** Providers shown on the Models step. Model names are from the live
 *  `aisa models` catalogue (2026-08-23); a representative few per provider. */
const PROVIDERS: Array<{ id: string; name: string; models: string }> = [
  { id: "claude", name: "Claude", models: "Sonnet 5 · Opus 5 · Haiku 4.5" },
  { id: "openai", name: "OpenAI", models: "GPT-5.5 · GPT-5.3-codex · 5.4-mini" },
  { id: "gemini", name: "Gemini", models: "Gemini 3.5 Flash" },
  { id: "deepseek", name: "DeepSeek", models: "V4 Pro · V4 Flash · R1" },
  { id: "kimi", name: "Kimi", models: "K3 · K2.7-code · K2 thinking" },
  { id: "glm", name: "GLM (Zhipu)", models: "GLM-5.2 · GLM-5.1 · GLM-5" },
  { id: "qwen", name: "Qwen", models: "Qwen3.7 Max · Qwen3 Coder" },
  { id: "grok", name: "Grok (xAI)", models: "Grok 4.6 · Grok 4.5" },
];

/** Clients we do not connect yet but will, shown so the roadmap is visible. */
const COMING_SOON: Array<{ id: string; label: string; note: string }> = [
  { id: "claude-ai", label: "Claude.ai", note: "connector" },
  { id: "chatgpt", label: "ChatGPT", note: "connector" },
];

/** One paragraph per agent on what connecting it means, for the Your-agent
 *  step's side column. */
/** Why the Models step has nothing to offer a file-configured client. */
/** Backup-mode consent copy, per client — the same contract T1 shows. */
/** The wordmark recoloured for the paper background: the white "sa" of the
 *  dark-background original becomes the ink colour via currentColor. */
const LOGO_INK = LOGO.replace(/#FFFFFF/g, "currentColor");

function normCategory(c: string): string {
  return /^search/i.test(c) ? "Search & Research" : c;
}

export function renderT2Page(
  servers: LiveServer[],
  clients: ClientInfo[],
  token: string,
  keyed: boolean,
  canInstall: boolean,
  /**
   * Whether this machine still needs the AIsa CLI installed. Probed by the
   * caller, never in here: this function's output is snapshot-tested byte
   * for byte, and a live probe inside it froze one machine's answer into
   * the baseline — green wherever the CLI happened to be installed, red on
   * every CI runner (runs 74-84, 2026-09-03).
   */
  needsCli: boolean,
  view: "start" | "done",
  /**
   * Defaults to English so this signature could grow without moving a byte of
   * the rendered page: the picker that will set it is a later step, and the
   * snapshots guarding this refactor have to stay green in between.
   */
  lang: Lang = "en"
): string {
  const T = (x: { en: string; zh: string }) => t(x, lang);
  /** A per-agent map of Text, flattened to the current language. */
  const resolved = (m: Record<string, { en: string; zh: string }>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, t(v, lang)]));
  const totalTools = servers.reduce((n, s) => n + s.toolCount, 0);
  const cats = new Map<string, LiveServer[]>();
  for (const s of servers) {
    const c = normCategory(s.category);
    cats.set(c, [...(cats.get(c) ?? []), s]);
  }
  const ORDER = ["Search & Research", "Finance", "Social", "Sales"];
  const rank = (c: string) => (ORDER.indexOf(c) === -1 ? 99 : ORDER.indexOf(c));
  const catList = [...cats.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));

  // ── data handed to the page script ──
  const SERVERS = servers.map((s) => ({
    slug: s.slug,
    endpoint: s.endpoint,
    name: stripped(s.name),
    category: normCategory(s.category),
    toolCount: s.toolCount,
    description: s.description,
  }));
  // Windsurf is not part of this flow (its file path stays in T1). claude.ai
  // on the web is parked until AIsa is in the Connector Directory — the
  // hand-off page below is ready, the card is not offered; see mcp.md T20.
  const CLIENTS = clients
    .map((c) => ({
      id: c.id,
      label: c.label,
      kind: c.kind,
      detected: c.detected,
      detail: c.detail,
      installable: !c.detected && Boolean(INSTALLERS[c.id]) && canInstall,
      command: INSTALLERS[c.id]?.command ?? "",
    }));
  const MODEL_FOR = Object.fromEntries(clients.map((c) => [c.id, defaultModelsFor(c.id).model]));

  // ── step 1: welcome ──
  const logoStrip = PROVIDERS.slice(0, 6).map(
    (p) => `<span class="blogo" title="${p.name}">${BRAND_LOGOS[p.id] ?? ""}</span>`
  ).join("");
  const welcome = `
<h1>${T(STEP_WELCOME.h1).replace("Every major model", "<em>Every major model</em>")}</h1>
<p class="lede">${T(STEP_WELCOME.lede).replace("models and the real", "models <b>and</b> the real")}</p>
<div class="feat">
  <div class="ftile"><div class="fico">${I.sparkles}</div>
    <h3>${T(STEP_WELCOME.tiles[0].h3)}</h3>
    <p>${T(STEP_WELCOME.tiles[0].p)}</p>
    <div class="strip">${logoStrip}</div></div>
  <div class="ftile"><div class="fico">${I.finance}</div>
    <h3>${T(STEP_WELCOME.tiles[1].h3)}</h3>
    <p>${T(STEP_WELCOME.tiles[1].p)}</p></div>
  <div class="ftile"><div class="fico">${I.terminal}</div>
    <h3>${T(STEP_WELCOME.tiles[2].h3)}</h3>
    <p>${T(STEP_WELCOME.tiles[2].p)}</p></div>
  <div class="ftile"><div class="fico">${I.shield}</div>
    <h3>${T(STEP_WELCOME.tiles[3].h3)}</h3>
    <p>${T(STEP_WELCOME.tiles[3].p)}</p></div>
</div>`;

  // ── step 2: your agent ──
  // Order comes from the flow definition — the terminal numbers its menu from
  // the same list, so "pick 2" cannot mean two different agents.
  void AGENT_ORDER;
  const shown = CLIENTS.filter((c) => c.detected || c.installable).sort((a, b) => agentRank(a.id) - agentRank(b.id));
  const firstPick = shown.find((c) => c.detected) ?? shown[0];
  const rest = CLIENTS.filter((c) => !c.detected && !c.installable);
  const clientCard = (c: (typeof CLIENTS)[number], checked: boolean) => `
<label class="tile agent${checked ? " on" : ""}" data-cid="${c.id}">
  <input type="radio" class="dot" name="client" value="${c.id}"${checked ? " checked" : ""}${c.installable ? ' data-install="1"' : ""}>
  <span class="tlogo${c.id === "cursor" ? " mono" : ""}">${BRAND_LOGOS[c.id] ?? (c.id === "claude-desktop" ? BRAND_LOGOS["claude-ai"] : undefined) ?? CLIENT_LOGOS[c.id] ?? I.terminal}</span>
  <span class="tbody"><span class="thead"><span class="tname">${c.label}</span></span>
    <span class="tbrief" data-brief>${
      c.detected ? c.detail : installOffer(c.command ?? "", lang)
    }</span></span>
  ${c.kind === "web" ? `<span class="badge web end">${T(AGENT_BADGE.web)}</span>` : c.detected ? `<span class="badge ok end">${T(AGENT_BADGE.detected)}</span>` : `<span class="badge todo end" data-badge>${T(AGENT_BADGE.absent)}</span>`}</label>`;
  const agentCards = shown.map((c) => clientCard(c, c === firstPick)).join("");
  // Fixed order: Claude Desktop, ChatGPT, Cursor, VS Code — by how likely a
  // reader is to care, not by which list they come from.
  const chipOrder = ["claude-desktop", "claude-ai", "chatgpt", "cursor", "vscode"];
  // (vscode only lands here when it has never been run on this machine)
  const chips = [
    ...rest.map((c) => ({ id: c.id, html: `<span class="chip">${BRAND_LOGOS[c.id] ?? ""}${c.label} <i>${T(AGENT_BADGE.notFound)}</i></span>` })),
    ...COMING_SOON.map((c) => ({ id: c.id, html: `<span class="chip">${BRAND_LOGOS[c.id] ?? ""}${c.label} <i>${c.note} · ${T(AGENT_BADGE.soon)}</i></span>` })),
  ].sort((a, b) => chipOrder.indexOf(a.id) - chipOrder.indexOf(b.id));
  const restChips = chips.length ? `<div class="soon">${chips.map((c) => c.html).join("")}</div>` : "";
  const agent = `
<h1>${T(STEP_AGENT.question).replace("plug into", "<em>plug into</em>")}</h1>
<p class="lede">${T(STEP_AGENT.lede!)}</p>
<div class="grid1">${agentCards}</div>
${restChips}
<div class="side">
  <h3 id="agentNoteTitle">${T(AGENT_SIDE_TITLES.how)}</h3>
  <p id="agentNote"></p>
  <h3 id="agentHaveTitle">${T(AGENT_SIDE_TITLES.have)}</h3>
  <p id="agentHave"></p>
</div>`;

  // ── step 3: models ──
  const providerTiles = PROVIDERS.map(
    (p) => `<div class="ptile"><span class="blogo lg">${BRAND_LOGOS[p.id] ?? ""}</span>
<span class="pname">${p.name}</span><span class="pmodels">${p.models}</span></div>`
  ).join("");
  const models = `
<h1>${T(STEP_MODELS.h1).replace("one account", "<em>one account</em>")}</h1>
<p class="lede">${T(STEP_MODELS.lede)}</p>
<div class="pgrid">${providerTiles}</div>
<div class="callout">${I.sparkles}<div>${T(STEP_MODELS.callout)}</div></div>
<p class="rerun">${T(STEP_MODELS.rerun)}</p>

<h2>${T(STEP_MODELS.h2Prefix)}<span id="mClient">${T(STEP_MODELS.yourAgent)}</span>${T(STEP_MODELS.h2Suffix)}</h2>
<div id="mFresh" class="grid1 choice" style="display:none">
  <label class="tile on"><input type="radio" class="dot" name="lmodeFresh" value="switch" checked>
    <span class="tbody"><span class="thead"><span class="tname">${T(STEP_MODELS.freshSwitch.name)}</span><span class="badge rec">${T(STEP_MODELS.recommended)}</span></span>
    <span class="tbrief">${T(STEP_MODELS.freshSwitch.brief).replace("{model}", '<b id="mModel"></b>')}</span></span></label>
  <label class="tile"><input type="radio" class="dot" name="lmodeFresh" value="skip">
    <span class="tbody"><span class="thead"><span class="tname">${T(STEP_MODELS.notNow.name)}</span></span>
    <span class="tbrief">${T(STEP_MODELS.notNow.briefFresh)}</span></span></label>
</div>
<div id="mDetected" class="grid1 choice" style="display:none">
  <label class="tile on"><input type="radio" class="dot" name="lmodeDet" value="backup" checked>
    <span class="tbody"><span class="thead"><span class="tname">${T(STEP_MODELS.backup.name)}</span><span class="badge rec">${T(STEP_MODELS.recommended)}</span></span>
    <span class="tbrief" id="mBackup"></span></span></label>
  <label class="tile" id="mSwitch"><input type="radio" class="dot" name="lmodeDet" value="switch">
    <span class="tbody"><span class="thead"><span class="tname">${T(STEP_MODELS.switchIt.name)}</span></span>
    <span class="tbrief">${T(STEP_MODELS.switchIt.brief).replace("{model}", '<b id="mModel2"></b>')}</span></span></label>
  <label class="tile"><input type="radio" class="dot" name="lmodeDet" value="skip">
    <span class="tbody"><span class="thead"><span class="tname">${T(STEP_MODELS.notNow.name)}</span></span>
    <span class="tbrief">${T(STEP_MODELS.notNow.briefDetected)}</span></span></label>
</div>
<div id="mFile" class="callout" style="display:none">${I.shield}<div id="mFileText"></div></div>
<div id="modelwarn" class="modelwarn" style="display:none">
  <div class="mw-head">${T(STEP_MODELS.warn.head)}</div>
  <div class="mw-body">${T(STEP_MODELS.warn.body)}</div>
  <button type="button" class="mw-fix" id="modelfix">${T(STEP_MODELS.warn.fix)}</button>
</div>`;

  // ── step 4: capabilities ──
  const catTiles = catList
    .map(([cat, list]) => {
      const tools = list.reduce((n, s) => n + s.toolCount, 0);
      return `<button type="button" class="ctile" data-cat="${cat}">
  <span class="cico">${CATEGORY_ICON[cat] ?? I.sparkles}</span>
  <span class="cname">${cat}</span>
  <span class="cmeta">${fill(STEP_CAPS.tileMeta, lang, { n: list.length, noun: list.length > 1 ? T(STEP_CAPS.serversWord) : T(STEP_CAPS.serverWord), tools })}</span>
  <span class="cblurb">${CATEGORY_BLURB[cat] ? T(CATEGORY_BLURB[cat]) : ""}</span>
  <span class="csel" data-csel></span></button>`;
    })
    .join("");
  const serverTiles = catList
    .map(([cat, list]) =>
      list
        .map((s) => {
          const checked = MCP_DEFAULT_SLUGS.includes(s.slug);
          return `<label class="stile${checked ? " on" : ""}" data-cat="${cat}">
  <input type="checkbox" name="server" value="${s.slug}"${checked ? " checked" : ""}>
  <span class="tbody"><span class="thead"><span class="tname">${stripped(s.name)}</span>
    <span class="badge">${s.toolCount} tools</span></span>
    <span class="sdesc">${s.description}</span></span></label>`;
        })
        .join("")
    )
    .join("");
  const caps = `
<h1>${T(STEP_CAPS.h1).replace("reach", "<em>reach</em>")}</h1>
<p class="lede">${fill(STEP_CAPS.counts, lang, { areas: catList.length, servers: servers.length, tools: totalTools })} ${T(STEP_CAPS.ledeTail)}</p>
<div class="cgrid">${catTiles}</div>
<div class="spanel" id="spanel">
  <div class="sphead"><h2 id="spTitle">${T(STEP_CAPS.pickArea)}</h2><button type="button" class="link" id="spAll">${T(STEP_CAPS.selectAll)}</button></div>
  <div class="sgrid" id="sgrid">${serverTiles}</div>
</div>
<div class="tally" id="tally"></div>`;

  // ── step 5: install ──
  const install = `
<h1 id="inTitle">${T(STEP_INSTALL.h1).replace("connect", "<em>connect</em>").replace("接线", "<em>接线</em>")}</h1>
<p class="lede" id="inLede">${T(STEP_INSTALL.lede)}</p>
<div class="plan" id="plan"></div>
<div class="barwrap" id="barwrap" style="display:none"><div class="barfill" id="barfill"></div></div>
<div class="barnote" id="barnote"></div>
<div class="authnote">${I.shield}<div>${
    keyed ? T(STEP_INSTALL.authKeyed) : T(STEP_INSTALL.authFresh)
  }</div></div>
<div id="inResult" class="fine"></div>`;

  // ── step 6: done (filled by the page script from /status) ──
  const done = `<div id="doneBody"><div class="eyebrow">${T(STEP_DONE.eyebrow)}</div>
<h1>${T(STEP_DONE.h1)}</h1><p class="lede">${T(STEP_DONE.lede)}</p></div>`;

  const rail = STEP_TITLES.map(
    (s) => `<button type="button" class="rstep" data-step="${s.n}">
  <span class="rn">${s.n}</span><span class="rt"><span class="rtitle">${T(s.title)}</span><span class="rsub">${T(s.sub)}</span></span></button>`
  ).join("");

  // Top-right, and it sticks: the choice is posted back to the CLI, which
  // stores it, so the terminal beside this page switches too and the next run
  // opens in the same language. A picker that only changed the page would
  // leave the two surfaces disagreeing — the thing flow.ts exists to prevent.
  const langPicker = `<div class="langpick">${LANGS.map((code) =>
    `<button type="button" class="lang${code === lang ? " on" : ""}" data-lang="${code}">${LANG_LABEL[code]}</button>`
  ).join("")}</div>`;

  const body = `
<div class="wrap">
<div id="superseded" class="ssup" style="display:none"><div class="ssbox">
  <h2>${T(SUPERSEDED.title)}</h2>
  <p>${T(SUPERSEDED.body)} <b id="sscount">60</b> ${T(SUPERSEDED.seconds)}.</p>
</div></div>
<nav class="rail">
  <div class="railhead">${LOGO_INK}<span>Connect</span></div>
  <div class="railsteps">${rail}</div>
</nav>
<section class="main">
<div class="content">
  <div class="topnav"><button type="button" class="ghost" id="back">${T(NAV.back)}</button>${langPicker}</div>
  <div class="pane" data-pane="1">${welcome}</div>
  <div class="pane" data-pane="2">${agent}</div>
  <div class="pane" data-pane="3">${models}</div>
  <div class="pane" data-pane="4">${caps}</div>
  <div class="pane" data-pane="5">${install}</div>
  <div class="pane" data-pane="6">${done}</div>
  <div class="navbar">
    <button type="button" class="cta" id="next">${T(NEXT_WORD[1])}${I.arrow}</button>
    <span class="navnote" id="navnote"></span>
  </div>
</div>
</section>
</div>
<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var VIEW = ${JSON.stringify(view)};
  var SERVERS = ${JSON.stringify(SERVERS)};
  var CLIENTS = ${JSON.stringify(CLIENTS)};
  var MODEL_FOR = ${JSON.stringify(MODEL_FOR)};
  var EXAMPLES = ${JSON.stringify(EXAMPLES)};
  var BACKUP_COPY = ${JSON.stringify(resolved(BACKUP_COPY))};
  var COPY = ${JSON.stringify(runtimeCopy(lang))};
  var AGENT_NOTES = ${JSON.stringify(resolved(AGENT_NOTES))};
  var HAVE_NOTES = ${JSON.stringify(resolved(AGENT_HAVE_NOTES))};
  var FILE_MODEL_NOTE = ${JSON.stringify(resolved(FILE_MODEL_NOTE))};
  var NEEDS_CLI = ${JSON.stringify(needsCli)};
  var PROVIDER_ID = ${JSON.stringify(AISA_PROVIDER_ID)};
  var ART = ${JSON.stringify({ codex: CODEX_FACE, claude: CLAUDE_BOT, opencode: OPENCODE_MARK })};
  var LABEL = {}; CLIENTS.forEach(function (c) { LABEL[c.id] = c.label; });
  var BY_SLUG = {}; SERVERS.forEach(function (s) { BY_SLUG[s.slug] = s; });
  var ICON_COPY = ${JSON.stringify(I.copy)};
  var ICON_CHECK = ${JSON.stringify(I.check)};
  var VSCODE_LOGO = ${JSON.stringify(BRAND_LOGOS.vscode ?? "")};
  var CURSOR_LOGO = ${JSON.stringify(BRAND_LOGOS.cursor ?? "")};
  var CLAUDE_DT_LOGO = ${JSON.stringify(BRAND_LOGOS["claude-ai"] ?? "")};
  var MODEL_COUNT = ${VSCODE_MODELS.length};

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ── navigation ──
  var current = 1, unlocked = 1, locked = false, phase = "selecting";
  var panes = $$(".pane"), rails = $$(".rstep");
  var nextBtn = $("#next"), backBtn = $("#back"), navnote = $("#navnote");
  var ARROW = nextBtn.innerHTML.replace(/^[^<]*/, "");
  var NEXT_WORD = ${JSON.stringify(resolved(NEXT_WORD as unknown as Record<string, { en: string; zh: string }>))};

  // Switching reloads: the page is rendered by the CLI, so the new language
  // arrives the same way the first one did. Storing it first means the
  // terminal picks it up too.
  $$(".lang").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.classList.contains("on")) return;
      fetch("/lang?token=" + TOKEN, { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang: b.dataset.lang }) })
        .then(function () { location.reload(); })
        .catch(function () { location.reload(); });
    });
  });

  // ── the shared draft ──
  // The terminal is looking at the same run. Publishing every change here is
  // what lets it show what was ticked in this page, and pulling lets this
  // page show what was answered there. Neither is the master; rev decides
  // who was late and hands them the current state instead of accepting a
  // stale copy. (No backticks in here: this whole script is a template
  // literal, and one would end it.)
  // The ready flag gates writing until this page has read what is there.
  // Publishing first was self-defeating: the arrival publish bumped rev to
  // match the server, so the very next poll saw "nothing new" and the page
  // never adopted a run the terminal had already moved along. A surface has
  // to read the shared state before it is allowed to speak for it.
  var rev = 0, pushing = false, adopting = false, ready = false;
  function publish(patch) {
    if (!ready || pushing) return; pushing = true;
    fetch("/select?token=" + TOKEN, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ rev: rev }, patch)) })
      .then(function (r) { return r.json(); })
      .then(function (b) { if (typeof b.rev === "number") rev = b.rev; })
      .catch(function () {})
      .then(function () { pushing = false; });
  }
  function publishDraft(step) {
    // Applying someone else's change must not be republished as if it were
    // ours: that bumps rev for no reason and can bounce between surfaces.
    if (adopting) return;
    var c = chosenClient();
    publish({ step: step, draft: {
      clients: c ? [c.value] : [],
      install: c && c.dataset.install ? [c.value] : [],
      llmMode: llmMode(),
      servers: pickedServers(),
    } });
  }
  /** Apply what another surface chose, without echoing it straight back. */
  function adopt(s) {
    if (typeof s.rev !== "number" || s.rev === rev || !s.draft) return;
    rev = s.rev;
    adopting = true;
    try {
    var d = s.draft;
    if (d.clients && d.clients[0]) {
      var el = $('input[name="client"][value="' + d.clients[0] + '"]');
      if (el && !el.checked) { el.checked = true; syncAgent(); }
    }
    if (d.llmMode) {
      var m = $('input[name="lmodeDet"][value="' + d.llmMode + '"]')
           || $('input[name="lmodeFresh"][value="' + d.llmMode + '"]');
      if (m && !m.checked) { m.checked = true; syncModels(); }
    }
    if (d.servers) {
      var want = {}; d.servers.forEach(function (x) { want[x] = 1; });
      $$('input[name="server"]').forEach(function (i) {
        if (!!want[i.value] !== i.checked) { i.checked = !!want[i.value]; }
      });
      syncCaps();
    }
    // Answering in the terminal advances the run, so this page has to unlock
    // as far as the run has gone — gating on the Next button alone meant the
    // terminal could move to step 3 and this side would sit on step 1,
    // ignoring the update as out of range.
    if (s.currentStep && s.currentStep > current) {
      unlocked = Math.max(unlocked, Math.min(s.currentStep, 5));
      renderSteps();
      go(s.currentStep);
    }
    } finally { adopting = false; }
  }

  // While choosing, watch the shared draft so a choice made in the terminal
  // appears here. The run-progress poll below only starts after /apply, which
  // is far too late: the whole point is to stay in step *before* anything is
  // applied. Slower than that one (1.5s against 250ms) because a person
  // ticking boxes is not a progress bar.
  /**
   * Enter progress mode for a run this page did not start.
   *
   * The install view only ever opened from this page's own apply, so a run
   * driven from the terminal left step 5 unseen entirely — the page sat on
   * step 4 through the whole install and only reappeared at step 6 when it
   * was over. Watching the phase is what makes the step the user is actually
   * living through visible on both surfaces.
   */
  function enterProgress(s) {
    if (locked) return;
    lockSelections();
    serverSteps = s.steps || [];
    shown = {}; lastFlip = 0;
    unlocked = 5;
    renderSteps();
    go(5);
    if (!ticker) ticker = setInterval(tick, 250);
    poll();
  }

  // Always on, whatever step this page is on and whether or not a run is in
  // progress: being superseded can happen at any moment, and a tab that just
  // stops answering with no explanation is the worst version of it.
  setInterval(function () {
    fetch("/status?token=" + TOKEN)
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (!s.supersededUntil) return;
        var left = Math.max(0, Math.ceil((s.supersededUntil - Date.now()) / 1000));
        $("#superseded").style.display = "flex";
        $("#sscount").textContent = String(left);
      })
      .catch(function () {
        // Once it has actually closed, say so rather than leaving a live
        // countdown on a page nothing is behind any more.
        var box = $("#superseded");
        if (box && box.style.display === "flex") {
          box.querySelector("p").textContent = ${JSON.stringify(T(SUPERSEDED.closed))};
        }
      });
  }, 1000);

  var draftTimer = setInterval(function () {
    if (locked) { clearInterval(draftTimer); return; }
    fetch("/status?token=" + TOKEN)
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (s.phase === "selecting") { adopt(s); return; }
        clearInterval(draftTimer);
        enterProgress(s);
      })
      .catch(function () {});
  }, 1500);

  function go(n) {
    if (n < 1 || n > 6 || n > unlocked) return;
    current = n;
    // Only the step, never the draft. Publishing what is ticked here on mere
    // arrival made opening the page look like answering it: the terminal saw
    // the default agent appear and moved on, crediting a choice the user had
    // not made. A draft is published when someone changes something.
    publish({ step: n });
    panes.forEach(function (p) { p.classList.toggle("show", Number(p.dataset.pane) === n); });
    rails.forEach(function (r) {
      var k = Number(r.dataset.step);
      r.classList.toggle("active", k === n);
      r.classList.toggle("done", k < n || (k <= unlocked && k !== n && (locked || k < current)));
      r.classList.toggle("open", k <= unlocked);
    });
    backBtn.style.visibility = n === 1 ? "hidden" : "visible";
    if (n === 5) { renderInstallPane(); }
    else if (n === 6) { nextBtn.style.display = "none"; navnote.textContent = ""; revealCheck(); }
    else { nextBtn.style.display = ""; nextBtn.disabled = false; nextBtn.innerHTML = (locked ? "Next " : NEXT_WORD[n]) + ARROW; navnote.textContent = ""; }
    if (n === 5 && unlocked >= 6) { nextBtn.style.display = ""; nextBtn.innerHTML = "See your results " + ARROW; }
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (n === 2) syncAgent(); if (n === 3) syncModels(); if (n === 4) syncCaps();
  }
  rails.forEach(function (r) { r.addEventListener("click", function () { go(Number(r.dataset.step)); }); });
  backBtn.addEventListener("click", function () { go(current - 1); });

  // ── selection state ──
  function chosenClient() { return $('input[name="client"]:checked'); }
  function clientId() { var c = chosenClient(); return c ? c.value : null; }
  function installing() { var c = chosenClient(); return Boolean(c && c.dataset.install === "1"); }
  function clientKind() { var id = clientId(); var c = CLIENTS.filter(function (x) { return x.id === id; })[0]; return c ? c.kind : "file"; }
  function llmMode() {
    if (!clientId()) return "skip";
    if (clientKind() !== "cli" && clientId() !== "vscode") return "skip";
    if (installing()) return ($('input[name="lmodeFresh"]:checked') || {}).value || "skip";
    return ($('input[name="lmodeDet"]:checked') || {}).value || "skip";
  }
  function pickedServers() { return $$('input[name="server"]:checked').map(function (i) { return i.value; }); }

  // ── step 2 ──
  function syncAgent() {
    var id = clientId();
    $("#agentNoteTitle").textContent = id ? "How " + LABEL[id] + " connects" : "How it connects";
    $("#agentNote").innerHTML = id ? (AGENT_NOTES[id] || "") : "Pick an agent above.";
    var have = id && HAVE_NOTES[id];
    $("#agentHaveTitle").style.display = have ? "" : "none";
    $("#agentHave").style.display = have ? "" : "none";
    if (have) $("#agentHave").innerHTML = have;
    $$(".tile.agent").forEach(function (t) { t.classList.toggle("on", t.querySelector("input").checked); });
  }
  $$('input[name="client"]').forEach(function (r) { r.addEventListener("change", function () { syncAgent(); armed = false; publishDraft(current); }); });

  // ── step 3 ──
  var armed = false;
  function syncModels() {
    var id = clientId(), fresh = installing(), kind = clientKind();
    $("#mClient").textContent = id ? LABEL[id] : "your agent";
    $("#mModel").textContent = MODEL_FOR[id] || ""; $("#mModel2").textContent = MODEL_FOR[id] || "";
    var vsc = id === "vscode";
    $("#mFresh").style.display = kind === "cli" && fresh ? "" : "none";
    $("#mDetected").style.display = (kind === "cli" && !fresh) || vsc ? "" : "none";
    $("#mFile").style.display = kind !== "cli" && !vsc ? "" : "none";
    // VS Code has no "switch": Copilot's models cannot be replaced, only joined.
    $("#mSwitch").style.display = vsc ? "none" : "";
    if (vsc && $('input[name="lmodeDet"][value="switch"]').checked) $('input[name="lmodeDet"][value="backup"]').checked = true;
    if ((kind === "cli" && !fresh) || vsc) $("#mBackup").innerHTML = BACKUP_COPY[id] || "";
    if (kind !== "cli" && !vsc) $("#mFileText").innerHTML = FILE_MODEL_NOTE[id] || ${JSON.stringify(T(FILE_MODEL_FALLBACK))};
    $$(".choice .tile").forEach(function (t) { t.classList.toggle("on", t.querySelector("input").checked); });
    updateWarn();
  }
  function updateWarn() {
    var need = installing() && llmMode() === "skip";
    $("#modelwarn").style.display = need ? "" : "none";
    if (!need) armed = false;
  }
  $$('input[name="lmodeFresh"], input[name="lmodeDet"]').forEach(function (r) { r.addEventListener("change", function () { syncModels(); publishDraft(current); }); });
  $("#modelfix").addEventListener("click", function () {
    $('input[name="lmodeFresh"][value="switch"]').checked = true; syncModels();
  });

  // ── step 4 ──
  var activeCat = null;
  function syncCaps() {
    var picked = pickedServers();
    $$(".ctile").forEach(function (t) {
      var cat = t.dataset.cat;
      var n = SERVERS.filter(function (s) { return s.category === cat && picked.indexOf(s.slug) !== -1; }).length;
      var sel = t.querySelector("[data-csel]");
      sel.textContent = n ? n + " selected" : "";
      t.classList.toggle("has", n > 0);
      t.classList.toggle("active", cat === activeCat);
    });
    $$(".stile").forEach(function (t) {
      t.classList.toggle("on", t.querySelector("input").checked);
      t.style.display = t.dataset.cat === activeCat ? "" : "none";
    });
    $("#spanel").classList.toggle("open", Boolean(activeCat));
    $("#spTitle").textContent = activeCat ? activeCat : "Pick an area above";
    var tools = picked.reduce(function (n, s) { return n + (BY_SLUG[s] ? BY_SLUG[s].toolCount : 0); }, 0);
    $("#tally").innerHTML = picked.length
      ? "<b>" + picked.length + " server" + (picked.length > 1 ? "s" : "") + "</b> · " + tools + " tools selected"
      : COPY.nothingSelected;
  }
  $$(".ctile").forEach(function (t) { t.addEventListener("click", function () {
    activeCat = activeCat === t.dataset.cat ? null : t.dataset.cat; syncCaps();
    if (activeCat) $("#spanel").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }); });
  $$('input[name="server"]').forEach(function (c) { c.addEventListener("change", function () { syncCaps(); publishDraft(current); }); });
  $("#spAll").addEventListener("click", function () {
    if (!activeCat) return;
    var boxes = $$('.stile[data-cat="' + activeCat + '"] input');
    var all = boxes.every(function (b) { return b.checked; });
    boxes.forEach(function (b) { b.checked = !all; });
    syncCaps();
  });
  // Open the area holding the default selection so the page never starts blank.
  (function () { var first = $('input[name="server"]:checked'); if (first) activeCat = first.closest(".stile").dataset.cat; })();

  // ── next button ──
  nextBtn.addEventListener("click", function () {
    if (current === 2 && !clientId()) { navnote.textContent = "Pick an agent first."; return; }
    if (current === 3 && installing() && llmMode() === "skip" && !armed) {
      armed = true; updateWarn();
      var w = $("#modelwarn"); w.scrollIntoView({ block: "center", behavior: "smooth" });
      w.style.animation = "none"; void w.offsetWidth; w.style.animation = "mwshake .45s";
      nextBtn.innerHTML = "Continue without a model " + ARROW; return;
    }
    if (current === 4 && !pickedServers().length) { navnote.textContent = "Pick at least one server."; return; }
    if (current === 5) { if (unlocked >= 6) go(6); else start(); return; }
    unlocked = Math.max(unlocked, current + 1);
    go(current + 1);
  });

  // ── step 5: plan preview, start, animated progress ──
  var serverSteps = null;      // what the server reports
  var shown = {};              // step id -> state we are displaying
  var lastFlip = 0, ticker = null;
  var STATE_WORD = { pending: "waiting", running: "working…", ok: "done", fail: "failed", skip: "skipped" };
  var MIN_DWELL = 1800;        // a step stays visibly "working" and then "done" at least this long
  var LOW_DWELL = 3000;        // the balance step, when the account is running low

  function planPreview() {
    var id = clientId(), rows = [];
    if (installing()) rows.push(["Install " + LABEL[id], "through its official installer, no sudo"]);
    rows.push(["Install the AIsa CLI", NEEDS_CLI ? "npm install -g @aisa-one/cli — the aisa command for balance, top-up and key rotation" : "the aisa command is already on this machine"]);
    if (!${keyed}) rows.push(["Sign in to AIsa", "one browser approval — it issues your key"]);
    var n = pickedServers().length;
    rows.push([clientKind() === "web" ? "Prepare " + n + " connector URL" + (n === 1 ? "" : "s") : id === "cursor" ? "Prepare " + n + " Cursor install link" + (n === 1 ? "" : "s") : "Add " + n + " MCP server" + (n === 1 ? "" : "s"), clientKind() === "web" ? "for you to add in claude.ai" : id === "cursor" ? "one click each, confirmed inside Cursor" : "to " + LABEL[id]]);
    var m = llmMode();
    if (m === "switch") rows.push(["Point its models at AIsa", MODEL_FOR[id] + " by default; reversible"]);
    if (m === "backup") rows.push([COPY.planBackup[id] || COPY.planBackup.other, COPY.planBackupNote]);
    rows.push(["Check your AIsa balance", "so an empty account is never a surprise"]);
    return rows.map(function (r) {
      return "<div class='step pending'><span class='mark'></span><span class='body'><span class='lbl'>" + r[0] +
        "</span><span class='det'>" + r[1] + "</span></span><span class='st'>planned</span></div>";
    }).join("");
  }
  function renderInstallPane() {
    if (serverSteps) { renderSteps(); return; }
    $("#plan").innerHTML = planPreview();
    nextBtn.style.display = ""; nextBtn.disabled = true;
    nextBtn.innerHTML = (installing() ? "Install &amp; connect " : "Connect ") + ARROW;
    navnote.textContent = "Starting…";
    // Arriving here is the decision: the plan shows for a beat, then runs.
    // Only auto-start a run this page was navigated into by its own Next
    // button. Arriving at step 5 because another surface said so is not
    // consent: a terminal that publishes the step while still asking the user
    // to confirm would have the run applied out from under it.
    setTimeout(function () { if (current === 5 && !serverSteps && !locked && !adopting) start(); }, 500);
  }
  function renderSteps() {
    var steps = serverSteps || [];
    var rows = steps.map(function (s) {
      var st = shown[s.id] || "pending";
      var det = st === "pending" ? "" : (s.detail || "");
      return "<div class='step " + st + "'><span class='mark'></span><span class='body'><span class='lbl'>" + s.label +
        "</span>" + (det ? "<span class='det'>" + det + "</span>" : "") + "</span><span class='st'>" + STATE_WORD[st] + "</span></div>";
    }).join("");
    $("#plan").innerHTML = rows;
    var settled = steps.filter(function (s) { return /ok|skip|fail/.test(shown[s.id] || ""); }).length;
    var pct = steps.length ? Math.round(settled / steps.length * 100) : 0;
    $("#barwrap").style.display = ""; $("#barfill").style.width = pct + "%";
    var running = steps.filter(function (s) { return shown[s.id] === "running"; })[0];
    $("#barnote").textContent = settled + " of " + steps.length + " · " + (running ? running.label : pct === 100 ? "finished" : "…");
    var BTN = { install: "Installing…", signin: "Signing in…", mcp: "Connecting…", llm: "Configuring models…", auth: "Authorizing…", balance: "Finishing…" };
    if (running) { nextBtn.disabled = true; nextBtn.textContent = BTN[running.id.split(":")[0]] || "Working…"; }
  }
  function caughtUp() {
    return (serverSteps || []).every(function (s) { return shown[s.id] === s.state; });
  }
  function tick() {
    var now = Date.now();
    var steps = serverSteps || [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i], cur = shown[s.id] || "pending";
      if (cur === s.state) continue;
      var dwell = s.id === "balance" && lastStatus && lastStatus.balanceMicros !== null &&
        lastStatus.balanceMicros !== undefined && lastStatus.balanceMicros <= 5e6 ? LOW_DWELL : MIN_DWELL;
      if (cur === "pending" && (s.state === "running" || /ok|skip|fail/.test(s.state))) {
        // Even an instant step gets a visible moment of work before its tick.
        if (now - lastFlip < MIN_DWELL && lastFlip) break;
        shown[s.id] = "running"; lastFlip = now; renderSteps(); break;
      }
      if (cur === "running" && /ok|skip|fail/.test(s.state)) {
        if (now - lastFlip < dwell) break;
        shown[s.id] = s.state; lastFlip = now; renderSteps(); break;
      }
      break; // a running step stays running until the server settles it
    }
    if ((phase === "done" || phase === "failed") && caughtUp()) {
      // One last beat on the final tick, then tell the process the checklist
      // has been seen — only now may it open the results tab.
      if (now - lastFlip < MIN_DWELL) return;
      clearInterval(ticker); ticker = null;
      finish();
      fetch("/seen?token=" + TOKEN, { method: "POST" }).catch(function () {});
    }
  }
  function finish() {
    var failed = (serverSteps || []).filter(function (s) { return s.state === "fail"; }).length;
    $("#inTitle").innerHTML = failed ? "Finished, <em>with " + failed + " issue" + (failed > 1 ? "s" : "") + "</em>" : "All <em>connected</em>";
    $("#inLede").textContent = failed ? COPY.ledeFailed : COPY.ledeAllRan;
    unlocked = 6; rails.forEach(function (r) { r.classList.add("open"); });
    renderSteps();
    nextBtn.disabled = false; nextBtn.style.display = ""; nextBtn.innerHTML = "See your results " + ARROW;
    navnote.textContent = VIEW === "start" && lastStatus && lastStatus.doneUrl ? "A results tab also opened on its own." : "";
    renderDone();
    rails[4].classList.add("done");
  }
  function lockSelections() {
    locked = true;
    $$('.pane[data-pane="2"] input, .pane[data-pane="3"] input, .pane[data-pane="4"] input').forEach(function (i) { i.disabled = true; });
    $$(".ctile, #spAll").forEach(function (b) { b.disabled = false; });
    document.body.classList.add("locked");
  }
  function start() {
    var body = { servers: pickedServers(), clients: [clientId()], install: installing() ? [clientId()] : [], llmMode: llmMode() };
    nextBtn.disabled = true; nextBtn.textContent = installing() ? "Installing…" : "Connecting…";
    navnote.textContent = "";
    lockSelections();
    fetch("/apply", { method: "POST", headers: { "content-type": "application/json", "x-connect-token": TOKEN }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) { serverSteps = d.steps; shown = {}; lastFlip = 0; renderSteps(); ticker = setInterval(tick, 250); poll(); });
  }
  function poll() {
    fetch("/status?token=" + TOKEN).then(function (r) { return r.json(); }).then(function (s) {
      phase = s.phase; serverSteps = s.steps; lastStatus = s;
      if (phase === "selecting") adopt(s);
      syncClientCard(s.steps);
      if (phase === "done" || phase === "failed") { document.title = "✓ AIsa Connected"; return; }
      setTimeout(poll, 1000);
    }).catch(function () { setTimeout(poll, 1500); });
  }
  var lastStatus = null;
  function syncClientCard(steps) {
    (steps || []).forEach(function (s) {
      if (s.id.indexOf("install:") !== 0 || s.state !== "ok") return;
      var card = $('.tile.agent[data-cid="' + s.id.slice(8) + '"]'); if (!card) return;
      var b = card.querySelector("[data-badge]"); if (b) { b.className = "badge ok"; b.textContent = "✓ installed"; }
      var br = card.querySelector("[data-brief]"); if (br) br.innerHTML = "<b>Installed</b> — " + (s.detail || "ready");
    });
  }

  // ── step 6 ──
  var doneRendered = false;
  // The tick after the headline draws itself only once the results pane is
  // actually on screen, a beat after it appears.
  function revealCheck() {
    if (doneRendered) return;
    var c = $(".h1check"); if (!c) return;
    doneRendered = true;
    setTimeout(function () { c.classList.add("show"); }, 350);
  }
  function fmtUsd(m) { return "$" + (m / 1e6).toFixed(2); }
  function renderDone() {
    var s = lastStatus; if (!s || !s.selection) return;
    doneRendered = false;
    var sel = s.selection, steps = s.steps || [];
    var id = sel.clients[0], name = LABEL[id] || id;
    var chosen = sel.servers.map(function (x) { return BY_SLUG[x]; }).filter(Boolean);
    var tools = chosen.reduce(function (n, x) { return n + x.toolCount; }, 0);
    var failed = steps.filter(function (x) { return x.state === "fail"; });
    var mcpFailed = failed.some(function (x) { return x.id === "mcp"; });
    var installed = steps.filter(function (x) { return x.id.indexOf("install:") === 0 && x.id !== "install:aisa-cli" && x.state === "ok"; })
      .map(function (x) { return LABEL[x.id.slice(8)] || x.id.slice(8); });
    var llmOk = steps.some(function (x) { return x.id === "llm" && x.state === "ok"; });
    var backup = sel.llmMode === "backup";
    var bin = id === "codex" ? (backup ? "codex-aisa" : "codex") : id === "claude-code" ? (backup ? "claude-aisa" : "claude") : id === "opencode" ? "opencode" : null;

    var head = mcpFailed
      ? "<div class='eyebrow'>Almost there</div><h1>Your agent is <em>not connected yet</em></h1><p class='lede'>The MCP entries could not be added to <b>" + name + "</b> — details below.</p>"
      : (installed.length
        ? "<h1><em>Congratulations!</em> " + installed.join(" & ") + " is installed and armed with " + tools + " powerful tools<span class='h1check'>" + ICON_CHECK + "</span></h1><p class='lede'><b>" + installed.join(" & ") + "</b> is on this machine, signed in to AIsa" + (llmOk ? ", running on <b>" + MODEL_FOR[id] + "</b> through AIsa," : ",") + " with " + chosen.length + " MCP server" + (chosen.length > 1 ? "s" : "") + " wired in — a complete setup, nothing else to configure.</p>"
        : "<h1><em>Congratulations!</em> Your agent just got " + tools + " powerful new tool" + (tools > 1 ? "s" : "") + ".<span class='h1check'>" + ICON_CHECK + "</span></h1><p class='lede'>" + (id === "claude-ai"
          ? chosen.length + " connector URL" + (chosen.length > 1 ? "s are" : " is") + " ready for <b>Claude.ai</b> — add them below, it takes about a minute."
          : id === "cursor" && s.deeplinks && s.deeplinks.length
          ? chosen.length + " install link" + (chosen.length > 1 ? "s are" : " is") + " ready for <b>Cursor</b> — one click each, below."
          : chosen.length + " AIsa MCP server" + (chosen.length > 1 ? "s are" : " is") + " now installed and signed in for <b>" + name + "</b> — nothing else to configure.") + "</p>");

    var failBlock = failed.length ? "<div class='authnote warn'><div><b>" + failed.length + " step" + (failed.length > 1 ? "s" : "") + " did not complete:</b><ul>" +
      failed.map(function (x) { return "<li><b>" + x.label + "</b> — " + (x.detail || "failed") + "</li>"; }).join("") +
      "</ul>Fix the above, then run <code>npx @aisa-one/cli connect</code> again — it is safe to re-run.</div></div>" : "";
    var ICON = { ok: "✓", fail: "✕", skip: "–", pending: "·", running: "·" };
    var recap = "<h2>Everything you just gained</h2><div class='recap'><div class='rsum'>" + chosen.length + " capabilit" + (chosen.length === 1 ? "y" : "ies") + " · " + tools + " tools · " + name + "</div>" +
      // The balance has its own card right below, so its row stays out of the recap.
      steps.filter(function (x) { return x.id !== "balance"; }).map(function (x) { return "<div class='rrow " + x.state + "'><span class='rl'>" + x.label + "</span><span class='rd' title=\\"" + (x.detail || "").replace(/"/g, "&quot;") + "\\">" + (x.detail || "") + "</span><span class='ri'>" + ICON[x.state] + "</span></div>"; }).join("") + "</div>";
    var bal = s.balanceMicros, low = bal !== null && bal !== undefined && bal < 5e6;
    // The welcome-credit note is shown on every results page, whatever the
    // balance: it is the one place the top-up is explained.
    var gift = true;
    var balCard = "<div class='balcard" + (low || gift ? " low" : "") + "'><div><div class='balnum'>" + (bal === null || bal === undefined ? "—" : fmtUsd(bal)) + "</div><div class='ballbl'>AIsa balance</div></div><div class='balright'>" +
      (gift ? "<div class='giftnote'><b>AIsa has given you $1 to get started.</b> That covers your first few calls. Top up now so your agent never stops mid-task.</div>" : low ? "<div class='lownote'>Running a little low — a small top-up keeps your first calls flowing.</div>" : (bal === null || bal === undefined ? "<div class='lownote'>Could not read it just now — <code>aisa balance</code> will.</div>" : "")) +
      "<a class='cta sm' href='https://console.aisa.one/billing?source=aisa_cli' target='_blank' rel='noopener'>Top up now →</a></div></div>";
    var fileNote = "";
    if (id === "claude-desktop") {
      fileNote = "<div class='vsccard'><div class='vschead'><span class='blogo lg'>" + CLAUDE_DT_LOGO + "</span><div><b>Claude Desktop is ready</b>" +
        "<div class='fine' style='margin:0'>" + chosen.length + " MCP server" + (chosen.length > 1 ? "s" : "") + " (plus aisa-docs) are in its config — one restart loads them.</div></div>" +
        "<div class='termside'><button type='button' class='cta sm' id='launch'>Restart Claude Desktop →</button><span class='fine' id='launchnote'></span></div></div>" +
        "<div class='vscgrid'>" +
        "<div class='vscitem'><span class='srv'>Tools</span>After the restart, open the <b>tools menu</b> (🔧) in a chat — the <code>aisa-…</code> servers are there. Each runs as a small bridge that lives and dies with the app; no background service.</div>" +
        "<div class='vscitem'><span class='srv'>Across devices</span>Prefer one setup on every device? Add the same server URLs as <b>custom Connectors</b> under Settings → Connectors — they sync with claude.ai through your account.</div>" +
        "</div></div>";
    }
    if (id === "vscode") {
      var llmStep = steps.filter(function (x) { return x.id === "llm-backup"; })[0];
      var needsPaste = llmStep && /paste/.test(llmStep.detail || "");
      var modelsOn = sel.llmMode === "backup" && !needsPaste;
      fileNote = "<div class='vsccard'><div class='vschead'><span class='blogo lg'>" + VSCODE_LOGO + "</span><div><b>VS Code is ready</b>" +
        "<div class='fine' style='margin:0'>" + chosen.length + " MCP server" + (chosen.length > 1 ? "s" : "") + (modelsOn ? " and " + MODEL_COUNT + " AIsa models" : "") + " are in place — no reload needed.</div></div>" +
        "<div class='termside'><button type='button' class='cta sm' id='launch'>Open VS Code →</button><span class='fine' id='launchnote'></span></div></div>" +
        "<div class='vscgrid'>" +
        (modelsOn ? "<div class='vscitem'><span class='srv'>Models</span>Open <b>Chat</b> (<code>Ctrl+Cmd+I</code>), click the model name at the bottom-right of the input — the <b>AIsa</b> group lists Claude, GPT, DeepSeek, Kimi, GLM and Qwen. The AIsa extension already stored your key.</div>" : "") +
        "<div class='vscitem'><span class='srv'>Tools</span>Switch Chat to <b>Agent</b> mode and tick the <code>aisa-…</code> servers in the tools picker (🔧). They are listed under <b>Extensions → MCP Servers</b>; if one is missing, run <b>Reload Window</b> once.</div>" +
        "</div></div>";
      if (sel.llmMode === "backup" && needsPaste) {
        fileNote += "<h2>One paste in VS Code — your key</h2><div class='webcard'>" +
          "<p class='fine' style='margin:0 0 .6rem'>VS Code keeps model keys in its own encrypted store, which only its UI can write — so this is the one step it does not let us do for you.</p>" +
          "<ol class='websteps'><li>Open Chat (<code>Ctrl+Cmd+I</code>), click the <b>model name</b> at the bottom-right of the input, then <b>Manage Models…</b></li>" +
          "<li>Pick <b>AIsa</b> and paste your key when asked (it is stored securely by VS Code)</li>" +
          "<li>Back in the picker, choose any AIsa model — Claude, GPT, DeepSeek, Kimi, GLM, Qwen</li></ol>" +
          "<button type='button' class='cta sm' id='copykey'>Copy your AIsa key</button> <span class='fine' id='copykeynote'></span></div>";
      }
    }
    if (id === "cursor" && s.deeplinks && s.deeplinks.length) {
      fileNote = "<div class='vsccard'><div class='vschead'><span class='blogo lg mono'>" + CURSOR_LOGO + "</span><div><b>Cursor is ready</b>" +
        "<div class='fine' style='margin:0'>" + s.deeplinks.length + " install link" + (s.deeplinks.length > 1 ? "s" : "") + " below — one click each, confirmed inside Cursor.</div></div>" +
        "<div class='termside'><button type='button' class='cta sm' id='launch'>Open Cursor →</button><span class='fine' id='launchnote'></span></div></div>" +
        "<div class='vscgrid'>" +
        "<div class='vscitem'><span class='srv'>Tools</span>Each button opens Cursor with the entry ready; press <b>Install</b> there. Afterwards <b>Cursor Settings → MCP</b> lists them as <code>aisa-…</code>, and Agent mode can use them.</div>" +
        "<div class='vscitem'><span class='srv'>Models</span>Cursor keeps its own models for Tab and inline edits. For chat and Agent you can point it at AIsa by hand: <b>Settings → Models → Override OpenAI Base URL</b> = <code>https://api.aisa.one/v1</code> with your AIsa key.</div>" +
        "</div>" +
        s.deeplinks.map(function (d) {
          return "<div class='weburl'><div><span class='srv'>" + d.name + "</span><code>" + (BY_SLUG[d.slug] ? BY_SLUG[d.slug].endpoint : "") + "</code></div>" +
            "<a class='cta sm' href='" + d.url + "'>Add to Cursor →</a></div>";
        }).join("") + "</div>";
    }
    if (id === "claude-ai") {
      fileNote += "<h2>Finish in claude.ai — about a minute</h2><div class='webcard'>" +
        "<ol class='websteps'><li>Open <a class='lnk' href='https://claude.ai/settings/connectors' target='_blank' rel='noopener'>claude.ai → Settings → Connectors</a></li>" +
        "<li>Click <b>Add custom connector</b>, paste a name and URL from below, then <b>Add</b></li>" +
        "<li>Press <b>Connect</b> and approve the AIsa sign-in — once per connector</li></ol>" +
        chosen.map(function (x) {
          return "<div class='weburl'><div><span class='srv'>aisa-" + x.slug + "</span><code>" + x.endpoint + "</code></div>" +
            "<button type='button' data-copy=\\"" + x.endpoint + "\\">" + ICON_COPY + " Copy URL</button></div>";
        }).join("") + "</div>";
    }
    var backupNote = backup && id === "vscode" ? "" : backup ? "<p class='rerun'><b>" + COPY.backupIntact + "</b> " + (id === "opencode" ? COPY.backupOpencode : COPY.backupBin.split("{bin}").join(bin)) + "</p>" : "";
    var model = MODEL_FOR[id] || "";
    var preview = id === "opencode"
      ? "<pre class='termlogo oc'>" + ART.opencode + "</pre><div class='termline'>Welcome to <b>opencode</b></div><div class='termline dim'>model: <b>" + PROVIDER_ID + "/" + model + "</b> · via AIsa</div><div class='termline dim'>config: ~/.config/opencode/opencode.json</div>"
      : id === "codex"
      ? "<pre class='termlogo codex'>" + ART.codex + "</pre><div class='termline'>Welcome to <b>Codex</b>, OpenAI's command-line coding agent</div><div class='termline dim'>model: <b>" + model + "</b> · via AIsa</div>"
      : "<pre class='termlogo claude'>" + ART.claude + "</pre><div class='termline'><b class='ccname'>Claude Code</b></div><div class='termline dim'>" + model + " · via AIsa</div><div class='termline accent'>Using " + model + " (from .claude/settings.json)</div>";
    var launch = !mcpFailed && bin ? "<div class='termcard'><div class='termwin'><div class='termbar'><span class='tdot r'></span><span class='tdot y'></span><span class='tdot g'></span></div><div class='termbody'>" + preview + "</div></div>" +
      "<div class='termside'><button type='button' class='cta sm' id='launch'>Launch " + bin + " →</button><span class='fine' id='launchnote'></span></div></div>" : "";
    var withEx = chosen.filter(function (x) { return EXAMPLES[x.slug]; });
    var cards = withEx.length === 1 ? EXAMPLES[withEx[0].slug].slice(0, 2).map(function (t) { return { slug: withEx[0].slug, text: t }; })
      : withEx.slice(0, 4).map(function (x) { return { slug: x.slug, text: EXAMPLES[x.slug][0] }; });
    var examples = cards.map(function (c) {
      return "<div class='example'><div><span class='srv'>aisa-" + c.slug + "</span><div class='txt'>" + c.text + "</div></div><button type='button' data-copy=\\"" + c.text.replace(/"/g, "&quot;") + "\\">" + ICON_COPY + " Copy</button></div>";
    }).join("");
    var more = SERVERS.length - chosen.length;
    var rest = mcpFailed ? failBlock + recap + balCard
      : "<p class='lede'>You are connected to <b>AIsa</b> — one account for all the well-known models and the live data behind them." + (more > 0 ? " " + more + " more MCP server" + (more > 1 ? "s are" : " is") + " one <code>npx @aisa-one/cli connect</code> away." : "") + " See your account dashboard at <a class='lnk' href='https://console.aisa.one' target='_blank' rel='noopener'>console.aisa.one</a>.</p>" +
        failBlock + recap + balCard + fileNote + launch +
        "<h2>Try it now — paste one of these into " + name + (id === "claude-ai" || id === "cursor" ? " once the servers are added" : id === "claude-desktop" ? " after the restart" : "") + "</h2><div class='examples'>" + (examples || "<p class='fine'>Ask your agent to use any of the aisa-* MCP tools.</p>") + "</div>" +
        backupNote +
        "<p class='rerun'>${T(STEP_MODELS.rerun)}</p>";
    $("#doneBody").innerHTML = head + rest;
    $$("[data-copy]").forEach(function (b) { b.addEventListener("click", function () {
      navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function () {
        b.textContent = "Copied ✓"; setTimeout(function () { b.innerHTML = ICON_COPY + " Copy"; }, 1600); });
    }); });
    var ck = $("#copykey"); if (ck) ck.addEventListener("click", function () {
      fetch("/key?token=" + TOKEN).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.key) throw 0;
        return navigator.clipboard.writeText(d.key);
      }).then(function () { ck.textContent = "Copied ✓"; setTimeout(function () { ck.textContent = "Copy your AIsa key"; }, 1600); })
        .catch(function () { $("#copykeynote").innerHTML = COPY.noKeyStored; });
    });
    var lb = $("#launch"); if (lb) lb.addEventListener("click", function () {
      lb.disabled = true;
      fetch("/launch?token=" + TOKEN, { method: "POST" }).then(function (r) { if (!r.ok) throw 0; lb.textContent = id === "vscode" ? "✓ VS Code opened" : id === "cursor" ? "✓ Cursor opened" : id === "claude-desktop" ? "✓ Restarting…" : "✓ Opened in Terminal"; })
        .catch(function () { lb.style.display = "none"; $("#launchnote").innerHTML = id === "vscode" || id === "cursor" || id === "claude-desktop" ? COPY.cannotStartApp.split("{name}").join(name) : COPY.cannotOpenTerminal.split("{bin}").join(bin); });
    });
  }

  // ── hydrate: a run may already be in flight (the done tab, or a reload) ──
  function hydrate(s) {
    var sel = s.selection; if (!sel) return false;
    var c = $('input[name="client"][value="' + sel.clients[0] + '"]'); if (c) c.checked = true;
    $$('input[name="server"]').forEach(function (i) { i.checked = sel.servers.indexOf(i.value) !== -1; });
    var fresh = sel.install.length > 0;
    var r = $('input[name="' + (fresh ? "lmodeFresh" : "lmodeDet") + '"][value="' + sel.llmMode + '"]'); if (r) r.checked = true;
    var first = $('input[name="server"]:checked'); if (first) activeCat = first.closest(".stile").dataset.cat;
    syncAgent(); syncModels(); syncCaps(); lockSelections();
    phase = s.phase; serverSteps = s.steps; lastStatus = s;
    var settled = phase === "done" || phase === "failed";
    if (settled || VIEW === "done") {
      serverSteps.forEach(function (x) { shown[x.id] = x.state; });
      unlocked = 6; renderSteps(); finish();
      syncClientCard(s.steps);
    } else {
      unlocked = 5; renderSteps(); ticker = setInterval(tick, 250); poll();
    }
    return true;
  }
  fetch("/status?token=" + TOKEN).then(function (r) { return r.json(); }).then(function (s) {
    if (hydrate(s)) { go(VIEW === "done" || s.phase === "done" || s.phase === "failed" ? (VIEW === "done" ? 6 : 5) : 5); return; }
    // Land where the run is, not where a run would start. hydrate only knows
    // about a run already applying; a run still being chosen — in the
    // terminal, say — was answered here with go(1), throwing away the step
    // the shared draft had already reached.
    if (s.phase === "selecting") { adopt(s); ready = true; }
    go(Math.max(current, 1));
  }).catch(function () { ready = true; go(1); });
})();
</script>`;

  return shellT2(view === "done" ? "✓ AIsa Connected" : "AIsa Connect", body);
}

// ── T2 shell: same brand tokens as T1, a rail + main layout ─────────────────
function shellT2(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --paper: ${PAPER}; --ink: #1c1b1a; --muted: #6d6a66; --line: #e7e4df; --card: #ffffff;
    --red: ${RED}; --red-cta: ${RED_CTA}; --bar: ${INK}; --tint: #fdf1ef; --ok: #2e7d43; --warn: #f59e0b; }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #141312; --ink: #f0eeeb; --muted: #9b9792; --line: #2c2a27; --card: #1d1c1a;
      --tint: #2a1917; --ok: #57b06f; }
  }
  * { box-sizing: border-box; margin: 0; }
  html { scroll-behavior: smooth; }
  body { background: var(--paper); color: var(--ink);
    font: 18px/1.6 Inter, "Inter Fallback", "PingFang SC", ui-sans-serif, system-ui, sans-serif;
    background-image: radial-gradient(color-mix(in srgb, var(--muted) 22%, transparent) 1px, transparent 1px);
    background-size: 22px 22px; }
  .wrap { display: grid; grid-template-columns: 408px minmax(0, 1fr); min-height: 100vh; }
  /* The rail: same paper as the main area, one hairline between them. The
     wordmark sits at the top; the six steps float at the vertical centre so
     the space above and below them is equal at any window height. */
  .rail { border-right: 1px solid var(--line); padding: 1.6rem 2.2rem; position: sticky; top: 0;
    height: 100vh; display: flex; flex-direction: column; }
  .railhead { display: flex; align-items: flex-end; gap: .6rem; color: var(--ink); padding: 0 .6rem; }
  .railhead svg { width: 89px; height: auto; display: block; }
  .railhead span { font-weight: 600; font-size: 1.28rem; line-height: 1; color: var(--muted); padding-bottom: 4px; }
  /* Sits a little above centre: the gap below is noticeably larger than the gap above. */
  .railsteps { margin: auto 0; display: flex; flex-direction: column; gap: .3rem; padding-bottom: 22vh; }
  .rstep { display: flex; gap: .8rem; align-items: center; text-align: left; background: transparent;
    border: 0; border-radius: 8px; padding: .7rem .7rem; font: inherit; color: var(--muted);
    cursor: default; opacity: .55; position: relative; }
  .rstep.open { opacity: 1; cursor: pointer; }
  .rstep.open:hover { background: color-mix(in srgb, var(--tint) 60%, transparent); }
  .rstep .rn { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line);
    display: flex; align-items: center; justify-content: center; font-size: .82rem; font-weight: 700; }
  .rstep .rtitle { display: block; font-weight: 700; font-size: 1.08rem; color: var(--ink); }
  .rstep .rsub { display: block; font-size: .86rem; color: var(--muted); }
  .rstep.active { background: var(--card); box-shadow: 0 1px 0 var(--line), 0 0 0 1px var(--line); }
  .rstep.active .rn { background: var(--red); border-color: var(--red); color: #fff; }
  .rstep.done .rn { background: var(--ok); border-color: var(--ok); color: #fff; font-size: 0; }
  .rstep.done .rn::after { content: "\\2713"; font-size: .85rem; }
  /* The main area centres its content both ways; panes are capped so lines
     stay readable on a wide screen. */
  .main { display: flex; align-items: center; justify-content: center; padding: 2rem 4rem; }
  .content { width: 100%; max-width: 980px; }
  .ssup { position: fixed; inset: 0; background: rgba(13,13,11,.72); z-index: 99;
    display: flex; align-items: center; justify-content: center; backdrop-filter: blur(3px); }
  .ssbox { background: #fff; border: 1px solid var(--line); border-radius: 14px;
    padding: 1.8rem 2rem; max-width: 30rem; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
  .ssbox h2 { margin: 0 0 .6rem; font-size: 1.15rem; }
  .ssbox p { margin: 0; color: var(--muted); line-height: 1.6; }
  .ssbox #sscount { color: var(--red); font-variant-numeric: tabular-nums; font-size: 1.1rem; }
  .topnav { min-height: 3rem; margin-bottom: 2.4rem; display: flex; align-items: center; justify-content: space-between; }
  .langpick { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 999px; background: #fff; }
  .langpick .lang { border: 0; background: none; cursor: pointer; font: inherit; font-size: .82rem; color: var(--muted);
    padding: .3rem .72rem; border-radius: 999px; line-height: 1.4; }
  .langpick .lang:hover { color: var(--ink); }
  .langpick .lang.on { background: var(--ink); color: #fff; }
  .topnav .ghost { padding: .65rem 1.3rem; font-size: 1rem; }
  .pane { display: none; animation: fade .25s ease; }
  .pane.show { display: block; }
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @media (max-width: 960px) {
    .wrap { grid-template-columns: 1fr; }
    .rail { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
    .railsteps { flex-direction: row; flex-wrap: wrap; margin: .8rem 0 0; padding: 0; }
    .rail .rsub { display: none; }
    .main { padding: 1.6rem 5% 4rem; align-items: flex-start; }
  }
  .eyebrow { display: flex; align-items: center; gap: .55rem; color: var(--muted); font-size: .74rem;
    font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }
  .eyebrow::before { content: ""; width: 26px; height: 3px; background: var(--red); }
  h1 { font-size: 2.45rem; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; margin: .5rem 0 .6rem; }
  h1 em { font-style: normal; color: var(--red); }
  h2 { font-size: 1.15rem; font-weight: 700; margin: 2rem 0 .8rem; }
  h3 { font-size: 1rem; font-weight: 700; margin: 0 0 .3rem; }
  .lede { color: var(--muted); font-size: 1.08rem; }
  .fine { color: var(--muted); font-size: .86rem; margin-top: .9rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em;
    background: color-mix(in srgb, var(--muted) 12%, transparent); padding: .1em .35em; border-radius: 4px; }
  .badge { font-size: .72rem; font-weight: 700; padding: .16rem .6rem; border-radius: 99px;
    border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
  .badge.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
  .badge.todo { background: var(--warn); border-color: var(--warn); color: #fff; }
  .badge.rec { background: var(--red); border-color: var(--red); color: #fff; }
  .badge.web { background: var(--ink); border-color: var(--ink); color: #fff; }
  .webcard { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 1rem 1.2rem; margin: 0 0 1.4rem; }
  .websteps { margin: 0 0 .9rem 1.2rem; font-size: .98rem; } .websteps li { margin: .25rem 0; }
  .weburl { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .6rem 0; border-top: 1px dashed var(--line); }
  .weburl .srv { display: block; color: var(--red); font-weight: 600; font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; }
  .weburl code { font-size: .9rem; overflow-wrap: anywhere; }
  .weburl button { flex: none; display: inline-flex; align-items: center; gap: .35rem; font: inherit; font-size: .8rem; font-weight: 600;
    color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: .35rem .7rem; cursor: pointer; }
  .weburl button:hover { border-color: var(--red); color: var(--red); }
  /* welcome */
  .feat { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 1.8rem 0 1rem; }
  .ftile { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.3rem 1.4rem; }
  .ftile p { color: var(--muted); font-size: .95rem; }
  .fico { width: 38px; height: 38px; border-radius: 10px; background: var(--tint); color: var(--red);
    display: flex; align-items: center; justify-content: center; margin-bottom: .8rem; }
  .fico svg { width: 20px; height: 20px; }
  .strip { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .9rem; }
  .blogo { display: inline-flex; width: 26px; height: 26px; align-items: center; justify-content: center; }
  .blogo svg { width: 100%; height: 100%; }
  .blogo.lg { width: 36px; height: 36px; }
  /* Single-colour marks drawn for light backgrounds (Cursor) flip in dark mode. */
  @media (prefers-color-scheme: dark) { .mono svg { filter: invert(1); } }
  /* tiles (agents, model choice) */
  .two { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 2rem; margin-top: 1.6rem; align-items: start; }
  @media (max-width: 960px) { .two { grid-template-columns: 1fr; } }
  .side { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.2rem 1.4rem;
    font-size: .95rem; color: var(--muted); margin-top: 1.4rem; }
  .grid1 { display: grid; grid-template-columns: 1fr; gap: .8rem; margin-top: 1.6rem; }
  .choice.grid1 { margin-top: .4rem; }
  .choice .tile { align-items: center; }
  .choice .tbody { flex: 1; min-width: 0; }
  .choice .thead { width: 100%; }
  .badge.rec { margin-left: auto; }
  .side h3 { color: var(--ink); margin-top: 1rem; } .side h3:first-child { margin-top: 0; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
  .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .8rem; }
  @media (max-width: 720px) { .grid2, .grid3, .feat { grid-template-columns: 1fr; } }
  .tile { display: flex; gap: .8rem; align-items: flex-start; background: var(--card); border: 1px solid var(--line);
    border-left: 3px solid var(--line); border-radius: 10px; padding: 1rem 1.1rem; cursor: pointer;
    transition: border-color .15s, box-shadow .15s; }
  .tile:hover { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
  .tile.on { border-left-color: var(--red); background: color-mix(in srgb, var(--tint) 55%, var(--card)); }
  .tile input { position: absolute; opacity: 0; width: 0; height: 0; }
  .tile input.dot { position: static; opacity: 1; width: 20px; height: 20px; margin-top: .3rem; accent-color: var(--red-cta); flex: none; }
  .tile.agent { align-items: center; }
  .badge.end { margin-left: auto; flex: none; }
  .tlogo { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
  .tlogo svg { width: 100%; height: 100%; }
  .tbody { min-width: 0; } .thead { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .tname { font-weight: 700; } .tbrief { display: block; color: var(--muted); font-size: .9rem; margin-top: .2rem; }
  .choice { margin-top: .4rem; }
  .soon { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: 1rem; }
  .chip { display: inline-flex; align-items: center; gap: .4rem; font-size: .82rem; color: var(--muted);
    border: 1px dashed var(--line); border-radius: 99px; padding: .3rem .75rem; }
  .chip svg { width: 16px; height: 16px; }
  body.locked .tile, body.locked .stile { cursor: default; }
  body.locked .tile:not(.on), body.locked .stile:not(.on) { opacity: .45; }
  /* models */
  .pgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .8rem; margin: 1.6rem 0 1.2rem; }
  @media (max-width: 720px) { .pgrid { grid-template-columns: repeat(2, 1fr); } }
  .ptile { display: grid; grid-template-columns: 40px 1fr; grid-template-rows: auto auto; column-gap: .8rem;
    align-items: center; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; }
  .ptile .blogo { grid-row: 1 / 3; }
  .pname { font-weight: 700; } .pmodels { font-size: .8rem; color: var(--muted); }
  .callout { display: flex; gap: .8rem; align-items: flex-start; background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 1rem 1.1rem; color: var(--muted); font-size: .95rem; margin: 1rem 0; }
  .callout svg { flex: none; color: var(--red); margin-top: .15rem; }
  .callout b { color: var(--ink); }
  .rerun { margin: 1rem 0 0; font-size: 1.02rem; color: var(--muted); }
  .rerun + .rerun { margin-top: .35rem; }
  .rerun code { font-size: 1.05em; color: var(--ink); }
  .modelwarn { margin-top: 1rem; border: 2px solid var(--warn); border-radius: 10px;
    background: color-mix(in srgb, var(--warn) 12%, var(--card)); padding: .9rem 1rem; }
  .mw-head { font-weight: 800; color: color-mix(in srgb, #b45309 60%, var(--ink)); margin-bottom: .3rem; }
  .mw-body { font-size: .92rem; color: color-mix(in srgb, #92400e 45%, var(--ink)); }
  .mw-fix { margin-top: .7rem; background: var(--red-cta); color: #fff; border: 0; border-radius: 6px;
    padding: .5rem 1.2rem; font: inherit; font-weight: 700; cursor: pointer; }
  @keyframes mwshake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
  /* capabilities: the area grid, then the servers of the open area */
  .cgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: .9rem; margin: 1.6rem 0 1rem; }
  .ctile { position: relative; display: flex; flex-direction: column; gap: .25rem; align-items: flex-start; text-align: left;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.2rem 1.2rem 1.1rem;
    font: inherit; color: var(--ink); cursor: pointer; min-height: 168px; transition: border-color .15s, transform .15s; }
  .ctile:hover { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); transform: translateY(-1px); }
  .ctile.active { border-color: var(--red); box-shadow: 0 0 0 3px color-mix(in srgb, var(--red) 18%, transparent); }
  .ctile.has { border-left: 3px solid var(--ok); }
  .cico { width: 40px; height: 40px; border-radius: 10px; background: var(--tint); color: var(--red);
    display: flex; align-items: center; justify-content: center; margin-bottom: .4rem; }
  .cico svg { width: 20px; height: 20px; }
  .cname { font-weight: 800; font-size: 1.05rem; }
  .cmeta { font-size: .78rem; color: var(--muted); }
  .cblurb { font-size: .86rem; color: var(--muted); margin-top: .3rem; }
  .csel { position: absolute; top: .8rem; right: .9rem; font-size: .74rem; font-weight: 700; color: var(--ok); }
  .spanel { display: none; border: 1px solid var(--line); border-radius: 12px; background: color-mix(in srgb, var(--card) 60%, var(--paper));
    padding: 1rem 1.2rem 1.2rem; }
  .spanel.open { display: block; animation: fade .2s ease; }
  .sphead { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .sphead h2 { margin: .2rem 0 .8rem; }
  .link { background: none; border: 0; color: var(--red); font: inherit; font-size: .85rem; font-weight: 600; cursor: pointer; }
  .sgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .8rem; }
  .stile { display: flex; gap: .7rem; align-items: flex-start; background: var(--card); border: 1px solid var(--line);
    border-left: 3px solid var(--line); border-radius: 10px; padding: .9rem 1rem; cursor: pointer; }
  .stile.on { border-left-color: var(--red); background: color-mix(in srgb, var(--tint) 55%, var(--card)); }
  .stile input { width: 18px; height: 18px; margin-top: .2rem; accent-color: var(--red-cta); flex: none; }
  .sdesc { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    color: var(--muted); font-size: .88rem; margin-top: .2rem; }
  .tally { margin-top: 1rem; font-size: .95rem; color: var(--muted); }
  .tally b { color: var(--ink); }
  /* install */
  .plan { margin-top: 1.6rem; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: .4rem 1.2rem; }
  .step { display: flex; align-items: flex-start; gap: .8rem; padding: .8rem .2rem; border-bottom: 1px dashed var(--line);
    font-size: 1.02rem; opacity: .5; transition: opacity .3s; }
  .step:last-child { border-bottom: 0; }
  .step.running, .step.ok, .step.fail { opacity: 1; }
  .step .lbl { display: block; font-weight: 600; } .step .det { display: block; color: var(--muted); font-size: .86rem; margin-top: .1rem; }
  .step .st { margin-left: auto; font-size: .8rem; font-weight: 600; color: var(--muted); white-space: nowrap; padding-left: .6rem; }
  .step.ok .st { color: var(--ok); } .step.fail .st { color: var(--red); }
  .step .mark { flex: none; width: 22px; height: 22px; margin-top: .15rem; border-radius: 50%; border: 2px solid var(--line);
    display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff;
    transition: background .25s, border-color .25s; }
  .step.running .mark { border-color: var(--red); border-top-color: transparent; animation: r .8s linear infinite; }
  .step.ok .mark { background: var(--ok); border-color: var(--ok); animation: pop .35s ease; }
  .step.ok .mark::after { content: "\\2713"; }
  .step.ok .st, .step.fail .st { animation: fade .4s ease; }
  .step.fail .mark { background: var(--red); border-color: var(--red); } .step.fail .mark::after { content: "\\2715"; }
  .step.skip .mark { border-style: dotted; }
  @keyframes r { to { transform: rotate(360deg); } }
  @keyframes pop { 0% { transform: scale(.6); } 60% { transform: scale(1.2); } 100% { transform: scale(1); } }
  .barwrap { height: 5px; background: var(--line); border-radius: 99px; overflow: hidden; margin: 1rem 0 .3rem; }
  .barfill { height: 100%; width: 0; background: var(--red); border-radius: 99px; transition: width .4s ease; }
  .barnote { color: var(--muted); font-size: .82rem; min-height: 1.2em; }
  .authnote { display: flex; gap: .7rem; align-items: flex-start; background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 1rem 1.1rem; color: var(--muted); font-size: .92rem; margin-top: 1.2rem; }
  .authnote svg { flex: none; margin-top: .1rem; color: var(--red); } .authnote b { color: var(--ink); }
  .authnote.warn { border-color: var(--warn); } .authnote ul { margin: .4rem 0 .4rem 1.1rem; }
  /* nav */
  .navbar { display: flex; flex-direction: column; align-items: center; gap: .6rem; margin-top: 2.4rem; }
  .navnote { color: var(--red); font-size: .9rem; min-height: 1.2em; }
  .cta { display: inline-flex; align-items: center; justify-content: center; gap: .6rem; background: var(--red-cta); color: #fff;
    border: none; border-radius: 6px; font: inherit; font-weight: 600; font-size: 1.08rem; padding: .85rem 1.9rem; cursor: pointer;
    text-decoration: none; }
  .cta:hover { background: color-mix(in srgb, var(--red-cta) 88%, black); }
  .cta:disabled { opacity: .55; cursor: default; }
  .cta.sm { font-size: .95rem; padding: .6rem 1.3rem; }
  .ghost { background: transparent; border: 1px solid var(--line); color: var(--ink); border-radius: 6px; font: inherit;
    font-weight: 600; padding: .8rem 1.2rem; cursor: pointer; }
  .ghost:hover { border-color: var(--red); color: var(--red); }
  /* done */
  /* The tick sits at the end of the headline, headline-sized, and pops in
     once the pane is on screen. */
  .h1check { display: inline-flex; vertical-align: middle; margin-left: .45rem; width: .85em; height: .85em;
    border-radius: 50%; background: var(--red); color: #fff; align-items: center; justify-content: center;
    transform: scale(0); opacity: 0; }
  .h1check svg { width: .53em; height: .53em; }
  .h1check.show { animation: tickpop .5s cubic-bezier(.2,1.4,.4,1) forwards; }
  @keyframes tickpop { 0% { transform: scale(0); opacity: 0; } 70% { transform: scale(1.18); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
  .recap, .balcard, .launch { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 1rem 1.2rem; margin: 0 0 1.2rem; }
  .rsum { font-weight: 600; padding-bottom: .5rem; border-bottom: 1px dashed var(--line); margin-bottom: .5rem; }
  .rrow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .8rem; align-items: center;
    min-height: 2.9rem; padding: .3rem 0; border-bottom: 1px solid var(--line); }
  .rrow:last-child { border-bottom: 0; }
  /* Every row the same height: the detail is one line, clipped, full text on hover. */
  .rrow .rl { font-weight: 700; white-space: nowrap; }
  .rrow .rd { color: var(--muted); font-size: .92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rrow { height: 2.9rem; }
  .rrow .ri { font-weight: 800; }
  .rrow.ok .ri { color: var(--ok); } .rrow.fail .ri { color: var(--red); } .rrow.skip .ri { color: #9ca3af; }
  .balcard, .launch { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .balcard.low { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, var(--card)); }
  .balnum { font-size: 1.6rem; font-weight: 800; } .ballbl { font-size: .8rem; color: var(--muted); }
  .balright { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .giftnote { font-size: 1rem; color: color-mix(in srgb, #b45309 70%, var(--ink)); max-width: 30rem; }
  .giftnote b { color: var(--red); }
  .lownote { font-size: .9rem; color: color-mix(in srgb, #b45309 70%, var(--ink)); max-width: 26rem; }
  .launch .fine { margin-top: .2rem; }
  /* The launch card: a believable little terminal with the agent's own art. */
  .termcard { display: flex; justify-content: space-between; align-items: center; gap: 1.2rem; border: 1px solid var(--line);
    border-radius: 12px; background: var(--card); padding: 1rem 1.2rem; margin: 0 0 1.4rem; flex-wrap: wrap; }
  .termwin { background: #0d0d0b; border-radius: 10px; overflow: hidden; flex: 1 1 24rem; min-width: 0; box-shadow: inset 0 0 0 1px #262622; }
  .termbar { display: flex; gap: .38rem; padding: .5rem .7rem; background: #1a1a17; }
  .tdot { width: .62rem; height: .62rem; border-radius: 50%; }
  .tdot.r { background: #ff5f57; } .tdot.y { background: #febc2e; } .tdot.g { background: #28c840; }
  .termbody { padding: .6rem 1rem .8rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .74rem; line-height: 1.25; }
  .termlogo { margin: 0 0 .45rem; font-size: .3rem; line-height: 1.1; overflow-x: auto; }
  .termlogo.codex { color: #33d17a; }
  .termlogo.oc { color: #fafafa; font-size: .54rem; line-height: 1.15; }
  .termlogo.claude { color: #e07b54; font-size: .48rem; line-height: 1; }
  .termline { color: #d8d8d2; padding: .08rem 0; overflow-wrap: anywhere; } .termline b { color: #fff; }
  .termline.dim { color: #8a8a82; } .termline.accent { border-left: 2px solid #33d17a; padding-left: .5rem; }
  .ccname { color: #33d17a !important; }
  .termside { display: flex; flex-direction: column; align-items: flex-end; gap: .5rem; flex: none; }
  a.lnk { color: var(--red); text-decoration: none; font-weight: 600; }
  a.lnk:hover { text-decoration: underline; }
  .vsccard { border: 1px solid var(--line); border-radius: 12px; background: var(--card); padding: 1.1rem 1.3rem; margin: 0 0 1.4rem; }
  .vschead { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
  .vschead > div:nth-child(2) { flex: 1; min-width: 14rem; font-size: 1.05rem; }
  .vscgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: .9rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--line); }
  .vsccard .weburl:first-of-type { margin-top: .6rem; }
  .vscitem { font-size: .95rem; color: var(--muted); } .vscitem b, .vscitem code { color: var(--ink); }
  .vscitem .srv { display: block; color: var(--red); font-weight: 600; font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; margin-bottom: .25rem; }
  .examples { display: grid; gap: .8rem; }
  .example { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1rem 1.1rem; display: flex; gap: .9rem; align-items: flex-start; }
  .example .srv { color: var(--red); font-weight: 600; font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; display: block; margin-bottom: .25rem; }
  .example button { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: .35rem; font: inherit; font-size: .8rem;
    font-weight: 600; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: .35rem .7rem; cursor: pointer; }
  .example button:hover { border-color: var(--red); color: var(--red); }
</style></head><body>
${body}
</body></html>`;
}
