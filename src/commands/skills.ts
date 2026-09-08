import ora from "ora";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { error, success, hint, truncate } from "../utils/display.js";
import { expandHome, ensureDir, writeSkillFiles, removeDir, detectAgents } from "../utils/file.js";
import { AGENT_DIRS } from "../constants.js";
import {
  SKILLS_REPO,
  getSkillIndex,
  listSkills,
  resolveSlug,
  leafName,
  fetchSkillFiles,
  fetchSkillMarkdown,
  parseSkillFrontmatter,
  type SkillInfo,
} from "../skills-registry.js";

// --- Skill Templates (for init) ---

// Domain labels may stay; runnable steps use retained commands only.
const TEMPLATES: Record<string, string> = {
  default: `---
name: my-skill
description: "Describe what this skill does."
homepage: https://aisa.one
metadata: {"aisa":{"emoji":"","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY","compatibility":["openclaw","claude-code","hermes"]}}
---

# My Skill

Describe how an AI agent should use this skill.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

Same key as \`aisa login\`: \`AISA_API_KEY\`, then \`~/.aisa/key\`, then legacy login.

## Published tools

Discover → schema when needed → quote → authorized call. Do not invent tool names.
\`get_financial_company_facts\` is a published tool whose schema includes \`ticker\`.
Quote is not authorization. \`aisa call\` is billable.

\`\`\`bash
aisa search --input '{"query":"company facts"}' --json
aisa schema --input '{"tools":["get_financial_company_facts"]}' --json
aisa quote --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa quote -f request.json --json
aisa call -f - --json < request.json
\`\`\`

## Provider catalog

Read-only browse. Paths and prices are metadata, not a substitute for schema or quote.

\`\`\`bash
aisa api list
aisa api list --category finance
aisa api show financial
aisa api show financial /news
\`\`\`
`,

  llm: `---
name: llm-assistant
description: "Use AIsa's unified LLM gateway to chat with 70+ AI models."
homepage: https://aisa.one
metadata: {"aisa":{"emoji":"🤖","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY","compatibility":["openclaw","claude-code","hermes"]}}
---

# LLM Assistant Skill

Use the AIsa unified gateway to access 70+ language models through a single API.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Chat Completion

\`\`\`bash
aisa chat "Your question here" --model gpt-4.1-mini
\`\`\`

## Streaming

\`\`\`bash
aisa chat "Explain quantum computing" --model claude-opus-4-6 --stream
\`\`\`

## List Models

\`\`\`bash
aisa models
aisa models --provider anthropic
\`\`\`
`,

  search: `---
name: web-search
description: "Discover published AIsa tools for web and research queries, then schema/quote/call."
homepage: https://aisa.one
metadata: {"aisa":{"emoji":"🔍","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY","compatibility":["openclaw","claude-code","hermes"]}}
---

# Web Search Skill

Discover published Router tools for web or research questions. Use a tool name
exactly as search returned it. Do not invent names. Router does not guarantee
every former search-provider function.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Discover, inspect, quote, then call

\`\`\`bash
aisa search "web search" --json
aisa search "academic papers" --json
aisa schema --input '{"tools":["<exact tool from search>"]}' --json
aisa quote --input '{"calls":[{"call_id":"c1","tool":"<exact tool from search>","arguments":{}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"<exact tool from search>","arguments":{}}]}' --json
\`\`\`

Fill arguments from schema. Quote is not authorization. \`aisa call\` is billable.

Optional catalog browse (not a substitute for schema or quote):

\`\`\`bash
aisa api list --category search
aisa api show <provider>
\`\`\`
`,

  finance: `---
name: finance-analyst
description: "Discover published AIsa finance tools, then schema/quote/call."
homepage: https://aisa.one
metadata: {"aisa":{"emoji":"📊","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY","compatibility":["openclaw","claude-code","hermes"]}}
---

# Finance Analyst Skill

Discover published Router tools for financial questions. Do not invent tool
names. Router does not guarantee every former stock, crypto, or screener
shortcut.

\`get_financial_company_facts\` is a published tool whose schema includes \`ticker\`.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Discover, inspect, quote, then call

\`\`\`bash
aisa search "company facts" --json
aisa schema get_financial_company_facts --json
aisa quote --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"get_financial_company_facts","arguments":{"ticker":"AAPL"}}]}' --json
\`\`\`

Quote is not authorization. \`aisa call\` is billable.

Optional catalog browse (not a substitute for schema or quote):

\`\`\`bash
aisa api list --category finance
aisa api show financial
\`\`\`
`,

  twitter: `---
name: twitter-manager
description: "Discover published AIsa social tools, then schema/quote/call."
homepage: https://aisa.one
metadata: {"aisa":{"emoji":"🐦","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY","compatibility":["openclaw","claude-code","hermes"]}}
---

# Twitter Manager Skill

Discover published Router tools for social or Twitter/X questions. Use a tool
name exactly as search returned it. Do not invent names. Router does not
guarantee every former Twitter CLI function.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Discover, inspect, quote, then call

\`\`\`bash
aisa search "twitter" --json
aisa schema --input '{"tools":["<exact tool from search>"]}' --json
aisa quote --input '{"calls":[{"call_id":"c1","tool":"<exact tool from search>","arguments":{}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"<exact tool from search>","arguments":{}}]}' --json
\`\`\`

Fill arguments from schema. Quote is not authorization. \`aisa call\` is billable.

Optional catalog browse (not a substitute for schema or quote):

\`\`\`bash
aisa api list --category social
aisa api show <provider>
\`\`\`
`,

  video: `---
name: video-generator
description: "Discover published AIsa media tools, then schema/quote/call."
homepage: https://aisa.one
metadata: {"aisa":{"emoji":"🎬","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY","compatibility":["openclaw","claude-code","hermes"]}}
---

# Video Generator Skill

Discover published Router tools for media or video questions. Use a tool name
exactly as search returned it. Do not invent names. Router does not guarantee
former video-generation CLI functions.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Discover, inspect, quote, then call

\`\`\`bash
aisa search "video generation" --json
aisa schema --input '{"tools":["<exact tool from search>"]}' --json
aisa quote --input '{"calls":[{"call_id":"c1","tool":"<exact tool from search>","arguments":{}}]}' --json
aisa call --input '{"calls":[{"call_id":"c1","tool":"<exact tool from search>","arguments":{}}]}' --json
\`\`\`

Fill arguments from schema. Quote is not authorization. \`aisa call\` is billable.

Optional catalog browse (not a substitute for schema or quote):

\`\`\`bash
aisa api list
aisa api show <provider>
\`\`\`
`,
};

// --- Commands ---

function printSkill(s: SkillInfo): void {
  const emoji = s.emoji ? `${s.emoji} ` : "";
  console.log(`  ${emoji}${chalk.cyan.bold(s.name)} ${chalk.gray(s.slug)}`);
  if (s.description) {
    console.log(`    ${chalk.gray(truncate(s.description, 80))}`);
  }
  console.log();
}

export async function skillsListAction(options: {
  category?: string;
  limit?: string;
  refresh?: boolean;
}): Promise<void> {
  const spinner = ora("Fetching skills from GitHub...").start();

  try {
    const index = await getSkillIndex({ refresh: options.refresh });
    let skills = await listSkills(index);

    if (options.category) {
      const cat = options.category.toLowerCase();
      skills = skills.filter((s) => s.slug.split("/")[0].toLowerCase() === cat);
    }

    const total = skills.length;
    if (options.limit) skills = skills.slice(0, parseInt(options.limit));

    spinner.stop();

    if (skills.length === 0) {
      console.log(
        options.category
          ? `  No skills in category "${options.category}".`
          : "  No skills found."
      );
      if (options.category) {
        const categories = [...new Set(index.slugs.map((s) => s.split("/")[0]))];
        hint(`Categories: ${categories.join(", ")}`);
      }
      return;
    }

    console.log(
      chalk.bold(
        `\n  ${skills.length}${skills.length < total ? ` of ${total}` : ""} skills available\n`
      )
    );
    for (const s of skills) printSkill(s);

    hint("Install: aisa skills install <slug>");
    hint("Details: aisa skills show <slug>");
  } catch (err) {
    spinner.fail("Failed to fetch skills");
    error((err as Error).message);
  }
}

export async function skillsSearchAction(
  query: string,
  options: { limit?: string; refresh?: boolean }
): Promise<void> {
  const spinner = ora(`Searching skills: "${query}"...`).start();

  try {
    const index = await getSkillIndex({ refresh: options.refresh });
    const skills = await listSkills(index);

    const q = query.toLowerCase();
    let matches = skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );

    const total = matches.length;
    if (options.limit) matches = matches.slice(0, parseInt(options.limit));

    spinner.stop();

    if (matches.length === 0) {
      console.log(`  No skills found for "${query}".`);
      return;
    }

    console.log(
      chalk.bold(`\n  ${matches.length}${matches.length < total ? ` of ${total}` : ""} result(s)\n`)
    );
    for (const s of matches) printSkill(s);

    hint("Install: aisa skills install <slug>");
  } catch (err) {
    spinner.fail("Search failed");
    error((err as Error).message);
  }
}

export async function skillsShowAction(slug: string): Promise<void> {
  const spinner = ora(`Loading ${slug}...`).start();

  try {
    const index = await getSkillIndex();
    const canonical = resolveSlug(slug, index);

    const content = await fetchSkillMarkdown(canonical);
    const meta = parseSkillFrontmatter(canonical, content);
    const prefix = `${canonical}/`;
    const files = (index.blobs[canonical] || []).map((b) => b.path.slice(prefix.length));

    spinner.stop();

    const emoji = meta.emoji ? `${meta.emoji} ` : "";
    console.log(`\n  ${emoji}${chalk.cyan.bold(meta.name)}`);
    console.log(`  ${meta.description}`);
    console.log(`  Slug: ${chalk.gray(canonical)}`);
    console.log(`  Files: ${files.join(", ")}`);
    console.log(`  Source: ${chalk.gray(`https://github.com/${SKILLS_REPO}/tree/main/${canonical}`)}`);

    // Print SKILL.md body (after frontmatter)
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    if (body) {
      console.log(`\n${chalk.gray("─".repeat(60))}`);
      console.log(body);
    }

    console.log();
    hint(`Install: aisa skills install ${leafName(canonical)}`);
  } catch (err) {
    spinner.fail("Failed to load skill");
    error((err as Error).message);
  }
}

/** Agent skill loaders expect one directory level, named to match SKILL.md's `name:`. */
function installedName(canonical: string): string {
  return leafName(canonical);
}

/**
 * Marker recording which skill owns an installed directory.
 *
 * Frontmatter `name:` is not an identity: two skills in different categories can
 * share both a leaf name and a `name:`, and comparing those would let the second
 * install silently overwrite the first. The canonical slug is the only unique
 * key, and nothing in SKILL.md carries it.
 */
const MARKER_FILE = ".aisa-skill.json";

interface InstallMarker {
  slug: string;
  installedAt: string;
}

function readMarker(dir: string): InstallMarker | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, MARKER_FILE), "utf-8"));
    return typeof parsed?.slug === "string" ? (parsed as InstallMarker) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Identify the skill currently installed at `dir`. Falls back to frontmatter for
 * directories written before markers existed, where the name is all we have.
 */
function occupant(dir: string): { slug?: string; name?: string } | undefined {
  const marker = readMarker(dir);
  if (marker) return { slug: marker.slug };

  const skillMd = join(dir, "SKILL.md");
  if (!existsSync(skillMd)) return undefined;
  try {
    return { name: parseSkillFrontmatter("", readFileSync(skillMd, "utf-8")).name };
  } catch {
    return undefined;
  }
}

/**
 * Why replacing what is already installed would be unsafe, or undefined when it
 * is the same skill.
 *
 * Frontmatter `name:` cannot settle ownership: two skills in different
 * categories may share both a leaf name and a `name:`. That ambiguity is only
 * reachable when the caller named a category — a bare name would have been
 * rejected as ambiguous before we got here — so an unmarked directory is
 * treated as unverifiable exactly in that case.
 */
function describeConflict(
  present: { slug?: string; name?: string } | undefined,
  canonical: string,
  expectedName: string,
  requestedCanonical: boolean
): string | undefined {
  if (!present) return undefined;

  if (present.slug) {
    return present.slug === canonical ? undefined : `holds a different skill (${present.slug})`;
  }
  if (requestedCanonical) {
    return `holds an unmarked install that cannot be verified as ${canonical}`;
  }
  return present.name === expectedName ? undefined : `holds a different skill ("${present.name}")`;
}

export async function skillsInstallAction(
  slug: string,
  options: { agent?: string; force?: boolean }
): Promise<void> {
  const spinner = ora(`Fetching skill '${slug}' from GitHub...`).start();

  try {
    const index = await getSkillIndex();
    const canonical = resolveSlug(slug, index);
    const files = await fetchSkillFiles(canonical, index);

    if (files.length === 0) {
      spinner.fail("Skill not found");
      error(`No files found for "${canonical}" in ${SKILLS_REPO}`);
      return;
    }

    spinner.stop();

    // Determine targets
    let targets: string[];
    if (options.agent) {
      if (options.agent === "all") {
        targets = Object.keys(AGENT_DIRS);
      } else {
        if (!AGENT_DIRS[options.agent]) {
          error(`Unknown agent: ${options.agent}. Valid: ${Object.keys(AGENT_DIRS).join(", ")}, all`);
          return;
        }
        targets = [options.agent];
      }
    } else {
      targets = detectAgents(AGENT_DIRS);
      if (targets.length === 0) {
        targets = Object.keys(AGENT_DIRS);
      }
    }

    const dirName = installedName(canonical);
    const expectedName = parseSkillFrontmatter(
      canonical,
      files.find((f) => f.path === "SKILL.md")?.content.toString("utf-8") || ""
    ).name;
    const marker: InstallMarker = { slug: canonical, installedAt: new Date().toISOString() };

    // A bare name is only resolvable when the leaf is unique across the repo —
    // resolveSlug rejects it otherwise — so whatever occupies the directory must
    // be this skill. A canonical slug bypasses that check, which is exactly when
    // an unmarked directory becomes unverifiable.
    const requestedCanonical = slug.includes("/");

    let installed = 0;
    for (const agent of targets) {
      const dir = expandHome(join(AGENT_DIRS[agent], dirName));

      // A different skill already occupying this directory name means the
      // install would replace it. Compare canonical slugs where we have them —
      // names collide across categories.
      const exists = existsSync(dir);
      const present = exists ? occupant(dir) : undefined;
      const conflict =
        exists && !present
          ? // No marker and no readable SKILL.md: an interrupted install, or a
            // directory the user put there. Neither is safe to delete silently.
            "exists but is not a recognizable skill install"
          : describeConflict(present, canonical, expectedName, requestedCanonical);

      if (conflict && !options.force) {
        error(`${AGENT_DIRS[agent]}${dirName}/ ${conflict} — pass --force to replace`);
        continue;
      }

      // Replace rather than merge: writing over a directory only overwrites
      // files that happen to share a name, leaving the previous skill's scripts
      // and assets behind for an agent to keep loading. Keyed on the directory
      // existing, not on identifying its occupant — an unidentifiable directory
      // still must not be merged into.
      if (exists) removeDir(dir);

      ensureDir(dir);
      writeSkillFiles(dir, files);
      writeFileSync(join(dir, MARKER_FILE), JSON.stringify(marker, null, 2) + "\n", "utf-8");
      console.log(`  ${chalk.green("✓")} ${AGENT_DIRS[agent]}${dirName} (${agent})`);
      installed++;
    }

    if (installed === 0) {
      error("Nothing installed.");
      return;
    }
    success(`Skill '${canonical}' installed to ${installed} agent(s)`);
  } catch (err) {
    spinner.fail("Failed to install skill");
    error((err as Error).message);
  }
}

export function skillsRemoveAction(
  slug: string,
  options: { agent?: string; force?: boolean }
): void {
  // Installed directories use the leaf name, so a bare name is what's on disk.
  const requested = slug.replace(/^\/+|\/+$/g, "");
  const dirName = leafName(requested);
  // A canonical slug names one specific skill; a bare name names whatever holds
  // that directory.
  const wantsCanonical = requested.includes("/");

  let targets: string[];
  if (options.agent && options.agent !== "all") {
    targets = [options.agent];
  } else {
    targets = Object.keys(AGENT_DIRS);
  }

  let removed = 0;
  let refused = 0;

  for (const agent of targets) {
    const dir = expandHome(join(AGENT_DIRS[agent], dirName));
    if (!existsSync(dir)) continue;

    const marker = readMarker(dir);

    // Leaf names collide across categories, so deleting by name alone can take
    // out a different skill than the one asked for.
    if (wantsCanonical && !options.force) {
      if (marker && marker.slug !== requested) {
        error(`${AGENT_DIRS[agent]}${dirName}/ holds ${marker.slug}, not ${requested} — skipped`);
        refused++;
        continue;
      }
      // Pre-marker installs carry no slug, and a same-named skill from another
      // category is indistinguishable from the requested one.
      if (!marker) {
        error(
          `${AGENT_DIRS[agent]}${dirName}/ has no install marker — cannot verify it is ${requested} — skipped`
        );
        refused++;
        continue;
      }
    }
    if (!marker) {
      hint(`${AGENT_DIRS[agent]}${dirName}/ has no install marker — removing by directory name`);
    }

    removeDir(dir);
    console.log(`  ${chalk.green("✓")} Removed from ${AGENT_DIRS[agent]}`);
    removed++;
  }

  if (removed === 0) {
    console.log(
      refused > 0
        ? "  Nothing removed — pass --force to remove regardless of what is installed."
        : "  Skill not found in any agent directory."
    );
    return;
  }
  success(`Removed '${dirName}' from ${removed} agent(s)`);
}

export function skillsInitAction(
  name: string,
  options: { template?: string; bare?: boolean }
): void {
  const dir = resolve(name);

  if (existsSync(dir)) {
    error(`Directory '${name}' already exists.`);
    return;
  }

  mkdirSync(dir, { recursive: true });

  if (options.bare) {
    const minimal = TEMPLATES.default
      .replace("my-skill", name)
      .replace("Describe what this skill does.", `${name} skill.`);
    writeFileSync(join(dir, "SKILL.md"), minimal, "utf-8");
  } else {
    const template = options.template || "default";
    const content = TEMPLATES[template];
    if (!content) {
      error(`Unknown template: ${template}. Valid: ${Object.keys(TEMPLATES).join(", ")}`);
      removeDir(dir);
      return;
    }
    const filled = content.replace(/my-skill/g, name);
    writeFileSync(join(dir, "SKILL.md"), filled, "utf-8");
  }

  success(`Skill initialized: ${name}/`);
  console.log(`  ${chalk.gray(join(name, "SKILL.md"))}`);
  hint(`Edit SKILL.md, then submit via PR: https://github.com/${SKILLS_REPO}`);
}
