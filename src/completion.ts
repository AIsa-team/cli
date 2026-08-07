import type { Command, Option } from "commander";
import { readCache } from "./cache.js";
import { cacheScope } from "./api.js";
import {
  AGENT_DIRS,
  API_CATEGORIES,
  COINGECKO_IDS,
  MCP_CONFIGS,
  MEDIA_TYPES,
  VIDEO_MODELS,
} from "./constants.js";
import type { CatalogProvider, CatalogDetail } from "./catalog.js";
import type { SkillIndex } from "./skills-registry.js";

/**
 * Shell completion.
 *
 * The shell scripts are thin: they hand the words typed so far to a hidden
 * `__complete` subcommand and let the CLI decide. That keeps the command tree in
 * one place instead of duplicating it into three shell dialects.
 *
 * Everything dynamic (provider slugs, skill names, model ids) is read from the
 * on-disk cache only. A completion that made a network call would hang the
 * terminal on every Tab press, so a cold cache simply completes nothing.
 */

export interface Candidate {
  value: string;
  description?: string;
}

const SHELLS = ["bash", "zsh", "fish"] as const;
export type Shell = (typeof SHELLS)[number];

export function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

// ── Dynamic candidates, all cache-only ───────────────────────────────────────

function cachedProviders(): CatalogProvider[] {
  return readCache<{ apis?: CatalogProvider[] }>(`catalog/${cacheScope()}/category.json`)?.data.apis || [];
}

/**
 * Slugs usable with `aisa run`. A provider's id is not always its URL slug
 * (`brave-search` serves `/apis/v1/brave/...`), so prefer the real slug from any
 * cached detail and fall back to the id.
 */
function runSlugs(): Candidate[] {
  const out = new Map<string, string>();
  for (const provider of cachedProviders()) {
    const detail = readCache<{ api?: CatalogDetail }>(
      `catalog/${cacheScope()}/${provider.id.replace(/[^\w.-]/g, "_")}.json`
    )?.data.api;

    const first = detail?.endpoint_groups?.flatMap((g) => g.endpoints || [])[0];
    const slug = first
      ? first.path.replace(/^\/apis\/v1\//, "").split("/")[0]
      : provider.id;

    out.set(slug, `${provider.endpoint_count} endpoints`);
  }
  return [...out].map(([value, description]) => ({ value, description }));
}

function providerIds(): Candidate[] {
  return cachedProviders().map((p) => ({
    value: p.id,
    description: `${p.endpoint_count} endpoints`,
  }));
}

/** Endpoint paths within one provider, for `aisa run <slug> <TAB>`. */
function endpointPaths(slug: string): Candidate[] {
  for (const provider of cachedProviders()) {
    const detail = readCache<{ api?: CatalogDetail }>(
      `catalog/${cacheScope()}/${provider.id.replace(/[^\w.-]/g, "_")}.json`
    )?.data.api;
    if (!detail) continue;

    const endpoints = (detail.endpoint_groups || []).flatMap((g) => g.endpoints || []);
    const matching = endpoints.filter((e) =>
      e.path.replace(/^\/apis\/v1\//, "").startsWith(`${slug}/`)
    );
    if (matching.length > 0) {
      return matching.map((e) => ({
        value: `/${e.path.replace(/^\/apis\/v1\//, "").split("/").slice(1).join("/")}`,
        description: e.name,
      }));
    }
  }
  return [];
}

function skillSlugs(): Candidate[] {
  const index = readCache<SkillIndex>("skills/tree.json")?.data;
  if (!index) return [];
  // Leaf names are what install/remove operate on; the canonical slug is the hint.
  return index.slugs.map((slug) => ({
    value: slug.split("/").pop() as string,
    description: slug,
  }));
}

function skillCategories(): Candidate[] {
  const index = readCache<SkillIndex>("skills/tree.json")?.data;
  if (!index) return [];
  return [...new Set(index.slugs.map((s) => s.split("/")[0]))].map((value) => ({ value }));
}

function modelIds(): Candidate[] {
  const models = readCache<Array<{ id: string; owned_by?: string }>>(`models/${cacheScope()}.json`)?.data;
  return (models || []).map((m) => ({ value: m.id, description: m.owned_by }));
}

// ── Static candidate sets ────────────────────────────────────────────────────

const STATIC: Record<string, Candidate[]> = {
  agent: Object.keys(AGENT_DIRS).concat("all").map((value) => ({ value })),
  mcpAgent: Object.keys(MCP_CONFIGS).concat("all").map((value) => ({ value })),
  lang: ["curl", "python", "node", "typescript"].map((value) => ({ value })),
  searchType: [
    { value: "tavily" },
    { value: "youtube" },
    { value: "scholar" },
    { value: "smart", description: "currently degraded" },
    { value: "full", description: "currently degraded" },
  ],
  stockField: [
    "info",
    "estimates",
    "financials",
    "filings",
    "insider",
    "institutional",
    "news",
  ].map((value) => ({ value })),
  configKey: ["defaultModel", "baseUrl", "outputFormat", "twitterCookies", "twitterProxy"].map(
    (value) => ({ value })
  ),
  template: ["default", "llm", "search", "finance", "twitter", "video"].map((value) => ({ value })),
  videoModel: Object.entries(VIDEO_MODELS).map(([value, spec]) => ({
    value,
    description: spec.requiresMedia ? `needs --media ${spec.requiresMedia}` : undefined,
  })),
  mediaType: MEDIA_TYPES.map((value) => ({ value: `${value}=` })),
  apiCategory: API_CATEGORIES.map((value) => ({ value })),
  period: ["current", "1d", "7d", "30d", "90d", "1y"].map((value) => ({ value })),
  cryptoSource: ["coingecko", "financial"].map((value) => ({ value })),
  shell: SHELLS.map((value) => ({ value })),
  crypto: Object.keys(COINGECKO_IDS).map((value) => ({
    value: value.toUpperCase(),
    description: COINGECKO_IDS[value],
  })),
};

/**
 * Values for an option that takes an argument, keyed by "command path --option".
 * Matched longest-prefix-first so `skills install --agent` and `mcp setup
 * --agent` can differ.
 */
const OPTION_VALUES: Array<[string, () => Candidate[]]> = [
  ["mcp setup --agent", () => STATIC.mcpAgent],
  ["skills --agent", () => STATIC.agent],
  ["skills list --category", () => skillCategories()],
  ["skills init --template", () => STATIC.template],
  ["api list --category", () => STATIC.apiCategory],
  ["api search --provider", () => providerIds()],
  ["api code --lang", () => STATIC.lang],
  ["code --lang", () => STATIC.lang],
  ["video create --model", () => STATIC.videoModel],
  ["video create --media", () => STATIC.mediaType],
  ["chat --model", () => modelIds()],
  ["web-search --type", () => STATIC.searchType],
  ["stock --field", () => STATIC.stockField],
  ["crypto --period", () => STATIC.period],
  ["crypto --source", () => STATIC.cryptoSource],
  ["models --provider", () => [...new Set(modelIds().map((m) => m.description))].filter(Boolean).map((value) => ({ value: value as string }))],
];

/**
 * Positional-argument candidates, keyed by command path and argument index.
 * Callbacks receive the positionals parsed so far — never the raw word list,
 * whose last entry may be an option or an option's value
 * (`run financial --raw <TAB>`).
 */
const POSITIONAL: Array<[string, number, (positionals: string[]) => Candidate[]]> = [
  ["run", 0, () => runSlugs()],
  ["run", 1, (positionals) => endpointPaths(positionals[0])],
  ["api show", 0, () => providerIds()],
  ["api code", 0, () => runSlugs()],
  ["api code", 1, (positionals) => endpointPaths(positionals[0])],
  ["code", 0, () => runSlugs()],
  ["models show", 0, () => modelIds()],
  ["skills show", 0, () => skillSlugs()],
  ["skills install", 0, () => skillSlugs()],
  ["skills remove", 0, () => skillSlugs()],
  ["crypto", 0, () => STATIC.crypto],
  ["config set", 0, () => STATIC.configKey],
  ["config get", 0, () => STATIC.configKey],
  ["completion", 0, () => STATIC.shell],
];

// ── Command tree walking ─────────────────────────────────────────────────────

function visibleSubcommands(cmd: Command): Command[] {
  return (cmd.commands as Command[]).filter(
    (c) => !(c as unknown as { _hidden?: boolean })._hidden && !c.name().startsWith("__")
  );
}

/**
 * The subcommand commander runs when none is named — `aisa models --provider x`
 * is really `aisa models list --provider x`, so its options belong to the parent
 * position too.
 */
function defaultSubcommand(cmd: Command): Command | undefined {
  const name = (cmd as unknown as { _defaultCommandName?: string })._defaultCommandName;
  return name ? visibleSubcommands(cmd).find((c) => c.name() === name) : undefined;
}

/** The commands whose options apply at this position: the command, plus its default child. */
function optionScope(cmd: Command): Command[] {
  const fallback = defaultSubcommand(cmd);
  return fallback ? [cmd, fallback] : [cmd];
}

function optionCandidates(cmd: Command): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const scoped of optionScope(cmd)) {
    for (const option of scoped.options as Option[]) {
      if (option.hidden || !option.long || seen.has(option.long)) continue;
      seen.add(option.long);
      out.push({ value: option.long, description: option.description });
    }
  }
  out.push({ value: "--help", description: "display help" });
  return out;
}

function findOption(cmd: Command, flag: string): Option | undefined {
  for (const scoped of optionScope(cmd)) {
    const option = (scoped.options as Option[]).find((o) => o.long === flag || o.short === flag);
    if (option) return option;
  }
  return undefined;
}

function takesValue(cmd: Command, flag: string): boolean {
  const option = findOption(cmd, flag);
  return Boolean(option && (option.required || option.optional));
}

/**
 * Candidates for the position after `words` (which excludes the partial word
 * currently being typed — the shell filters by prefix itself).
 */
export function complete(program: Command, words: string[]): Candidate[] {
  let cmd = program;
  const path: string[] = [];
  const positionals: string[] = [];
  let i = 0;

  // Walk down the command tree, collecting positional args along the way.
  for (; i < words.length; i++) {
    const word = words[i];
    if (word.startsWith("-")) break;

    const child = visibleSubcommands(cmd).find(
      (c) => c.name() === word || c.aliases().includes(word)
    );
    if (!child) break;

    cmd = child;
    path.push(child.name());
  }

  // Remaining words are options and positional arguments.
  for (; i < words.length; i++) {
    const word = words[i];
    if (word.startsWith("-")) {
      if (takesValue(cmd, word)) {
        // The word being typed is this option's value.
        if (i === words.length - 1) {
          const key = `${path.join(" ")} ${word}`;
          const match = OPTION_VALUES.filter(([prefix]) => {
            const [prefixPath, prefixFlag] = [
              prefix.slice(0, prefix.lastIndexOf(" ")),
              prefix.slice(prefix.lastIndexOf(" ") + 1),
            ];
            return prefixFlag === word && key.startsWith(prefixPath);
          }).sort((a, b) => b[0].length - a[0].length)[0];
          return match ? match[1]() : [];
        }
        i++; // skip the value
      }
      continue;
    }
    positionals.push(word);
  }

  const commandPath = path.join(" ");
  const subcommands = visibleSubcommands(cmd).map((c) => ({
    value: c.name(),
    description: c.description(),
  }));

  const positional = POSITIONAL.filter(
    ([prefix, index]) => prefix === commandPath && index === positionals.length
  )
    .flatMap(([, , produce]) => produce(positionals))
    .filter(Boolean);

  return [...subcommands, ...positional, ...optionCandidates(cmd)];
}

// ── Shell scripts ────────────────────────────────────────────────────────────

export function completionScript(shell: Shell, binary = "aisa"): string {
  switch (shell) {
    case "bash":
      return `# aisa bash completion
# Install:  aisa completion bash > /usr/local/etc/bash_completion.d/aisa
#      or:  eval "$(aisa completion bash)"
_${binary}_complete() {
  local cur words
  cur="\${COMP_WORDS[COMP_CWORD]}"
  words=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")
  local candidates
  candidates=$(${binary} __complete -- "\${words[@]}" 2>/dev/null | cut -f1)
  COMPREPLY=($(compgen -W "\${candidates}" -- "\${cur}"))
}
complete -o default -F _${binary}_complete ${binary}
`;

    case "zsh":
      return `#compdef ${binary}
# aisa zsh completion
# Install:  aisa completion zsh > "\${fpath[1]}/_aisa"
#      or:  eval "$(aisa completion zsh)"
_${binary}() {
  local -a candidates
  local -a prior
  prior=(\${words[2,CURRENT-1]})
  # Output is "value<TAB>description"; _describe wants "value:description".
  candidates=(\${(f)"$(${binary} __complete -- \${prior} 2>/dev/null | sed 's/\\t/:/')"})
  _describe -t commands '${binary}' candidates
}
compdef _${binary} ${binary}
`;

    case "fish":
      return `# aisa fish completion
# Install:  aisa completion fish > ~/.config/fish/completions/aisa.fish
function __${binary}_complete
  set -l tokens (commandline -opc)
  ${binary} __complete -- $tokens[2..-1] 2>/dev/null
end
complete -c ${binary} -f -a '(__${binary}_complete)'
`;
  }
}
