import ora from "ora";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fetch from "node-fetch";
import { error, success, hint, truncate } from "../utils/display.js";
import { expandHome, ensureDir, writeSkillFiles, removeDir, detectAgents } from "../utils/file.js";
import { AGENT_DIRS } from "../constants.js";

// --- GitHub-backed skill registry ---

const SKILLS_REPO = "AIsa-team/agent-skills";
const GH_API = `https://api.github.com/repos/${SKILLS_REPO}`;
const GH_RAW = `https://raw.githubusercontent.com/${SKILLS_REPO}/main`;

interface GHTreeEntry {
  path: string;
  type: "blob" | "tree";
}

interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  emoji: string;
}

/** Fetch the repo tree and extract top-level skill folder names. */
async function fetchSkillSlugs(): Promise<string[]> {
  const res = await fetch(`${GH_API}/git/trees/main`);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = (await res.json()) as { tree: GHTreeEntry[] };
  // Top-level directories (excluding dotfiles, LICENSE, README) are skills
  return data.tree
    .filter(
      (e) =>
        e.type === "tree" &&
        !e.path.startsWith(".") &&
        e.path !== "node_modules"
    )
    .map((e) => e.path);
}

/** Fetch and parse SKILL.md frontmatter for a single skill. */
async function fetchSkillMeta(slug: string): Promise<SkillInfo | null> {
  const res = await fetch(`${GH_RAW}/${slug}/SKILL.md`);
  if (!res.ok) return null;
  const text = await res.text();
  return parseSkillFrontmatter(slug, text);
}

/** Parse YAML frontmatter from SKILL.md content. */
function parseSkillFrontmatter(slug: string, content: string): SkillInfo {
  const info: SkillInfo = { slug, name: slug, description: "", emoji: "" };

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return info;

  const frontmatter = match[1];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (nameMatch) info.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) info.description = descMatch[1].trim().replace(/^["']|["']$/g, "");

  const metaMatch = frontmatter.match(/^metadata:\s*(.+)$/m);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      info.emoji = meta?.openclaw?.emoji || "";
    } catch {
      // ignore malformed metadata
    }
  }

  return info;
}

/** Fetch all files in a skill folder from GitHub. */
async function fetchSkillFiles(slug: string): Promise<Array<{ path: string; content: string }>> {
  const treeRes = await fetch(`${GH_API}/git/trees/main?recursive=1`);
  if (!treeRes.ok) throw new Error(`GitHub API error: ${treeRes.status}`);
  const treeData = (await treeRes.json()) as { tree: GHTreeEntry[] };

  const prefix = `${slug}/`;
  const blobs = treeData.tree.filter(
    (e) => e.type === "blob" && e.path.startsWith(prefix)
  );

  const files: Array<{ path: string; content: string }> = [];
  await Promise.all(
    blobs.map(async (entry) => {
      const res = await fetch(`${GH_RAW}/${entry.path}`);
      if (!res.ok) return;
      const content = await res.text();
      const relativePath = entry.path.slice(prefix.length);
      files.push({ path: relativePath, content });
    })
  );

  return files;
}

// --- Skill Templates (for init) ---

const TEMPLATES: Record<string, string> = {
  default: `---
name: my-skill
description: "Describe what this skill does."
homepage: https://openclaw.ai
metadata: {"openclaw":{"emoji":"","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY"}}
---

# My Skill

Describe how an AI agent should use this skill.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Usage

\`\`\`bash
aisa run <slug> <path> -q "param=value"
\`\`\`
`,

  llm: `---
name: llm-assistant
description: "Use AISA's unified LLM gateway to chat with 70+ AI models."
homepage: https://openclaw.ai
metadata: {"openclaw":{"emoji":"🤖","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY"}}
---

# LLM Assistant Skill

Use the AISA unified gateway to access 70+ language models through a single API.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Chat Completion

\`\`\`bash
aisa chat "Your question here" --model gpt-4.1
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
description: "Search the web, YouTube, and academic papers via AISA APIs."
homepage: https://openclaw.ai
metadata: {"openclaw":{"emoji":"🔍","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY"}}
---

# Web Search Skill

Search the web, YouTube, and academic papers through AISA's unified search APIs.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Smart Search

\`\`\`bash
aisa web-search "latest AI research" --type smart
\`\`\`

## YouTube Search

\`\`\`bash
aisa web-search "machine learning tutorial" --type youtube
\`\`\`

## Scholar Search

\`\`\`bash
aisa scholar "transformer architecture"
\`\`\`
`,

  finance: `---
name: finance-analyst
description: "Access stock prices, earnings, SEC filings, and financial data via AISA."
homepage: https://openclaw.ai
metadata: {"openclaw":{"emoji":"📊","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY"}}
---

# Finance Analyst Skill

Access real-time and historical financial data through AISA's finance APIs.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Stock Prices

\`\`\`bash
aisa stock AAPL
aisa stock MSFT --field earnings
aisa stock TSLA --field filings
\`\`\`

## Crypto Prices

\`\`\`bash
aisa crypto BTC
aisa crypto ETH --period 30d
\`\`\`
`,

  twitter: `---
name: twitter-manager
description: "Search Twitter, get user profiles and trends via AISA."
homepage: https://openclaw.ai
metadata: {"openclaw":{"emoji":"🐦","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY"}}
---

# Twitter Manager Skill

Interact with Twitter/X through AISA's Twitter APIs.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Search Tweets

\`\`\`bash
aisa twitter search "AI agents" --limit 20
\`\`\`

## Get User Profile

\`\`\`bash
aisa twitter user elonmusk
\`\`\`

## Trending Topics

\`\`\`bash
aisa twitter trends
\`\`\`
`,

  video: `---
name: video-generator
description: "Generate videos from text prompts using AISA's video synthesis API."
homepage: https://openclaw.ai
metadata: {"openclaw":{"emoji":"🎬","requires":{"bins":["curl"],"env":["AISA_API_KEY"]},"primaryEnv":"AISA_API_KEY"}}
---

# Video Generator Skill

Generate videos from text prompts using AISA's AI video generation APIs.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Create Video

\`\`\`bash
aisa video create "A cat playing piano in a jazz bar"
\`\`\`

## Create and Wait for Result

\`\`\`bash
aisa video create "Sunset over mountains timelapse" --wait
\`\`\`

## Check Task Status

\`\`\`bash
aisa video status <task-id>
\`\`\`
`,
};

// --- Commands ---

export async function skillsListAction(_options: { category?: string; limit?: string }): Promise<void> {
  const spinner = ora("Fetching skills from GitHub...").start();

  try {
    const slugs = await fetchSkillSlugs();

    // Fetch all SKILL.md frontmatters in parallel
    const metas = await Promise.all(slugs.map((s) => fetchSkillMeta(s)));
    const skills = metas.filter((m): m is SkillInfo => m !== null);

    spinner.stop();

    if (skills.length === 0) {
      console.log("  No skills found.");
      return;
    }

    console.log(chalk.bold(`\n  ${skills.length} skills available\n`));

    for (const s of skills) {
      const emoji = s.emoji ? `${s.emoji} ` : "";
      console.log(`  ${emoji}${chalk.cyan.bold(s.name)} ${chalk.gray(s.slug)}`);
      if (s.description) {
        console.log(`    ${chalk.gray(truncate(s.description, 80))}`);
      }
      console.log();
    }

    hint("Install: aisa skills install <slug>");
    hint("Details: aisa skills show <slug>");
  } catch (err) {
    spinner.fail("Failed to fetch skills");
    error((err as Error).message);
  }
}

export async function skillsSearchAction(query: string, _options: { limit?: string }): Promise<void> {
  const spinner = ora(`Searching skills: "${query}"...`).start();

  try {
    const slugs = await fetchSkillSlugs();
    const metas = await Promise.all(slugs.map((s) => fetchSkillMeta(s)));
    const skills = metas.filter((m): m is SkillInfo => m !== null);

    const q = query.toLowerCase();
    const matches = skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );

    spinner.stop();

    if (matches.length === 0) {
      console.log(`  No skills found for "${query}".`);
      return;
    }

    console.log(chalk.bold(`\n  ${matches.length} result(s)\n`));

    for (const s of matches) {
      const emoji = s.emoji ? `${s.emoji} ` : "";
      console.log(`  ${emoji}${chalk.cyan.bold(s.name)} ${chalk.gray(s.slug)}`);
      if (s.description) {
        console.log(`    ${chalk.gray(truncate(s.description, 80))}`);
      }
      console.log();
    }

    hint("Install: aisa skills install <slug>");
  } catch (err) {
    spinner.fail("Search failed");
    error((err as Error).message);
  }
}

export async function skillsShowAction(slug: string): Promise<void> {
  const spinner = ora(`Loading ${slug}...`).start();

  try {
    // Fetch SKILL.md
    const res = await fetch(`${GH_RAW}/${slug}/SKILL.md`);
    if (!res.ok) {
      spinner.fail("Skill not found");
      error(`No skill "${slug}" in ${SKILLS_REPO}`);
      return;
    }

    const content = await res.text();
    const meta = parseSkillFrontmatter(slug, content);

    // Fetch file list
    const treeRes = await fetch(`${GH_API}/git/trees/main?recursive=1`);
    const treeData = (await treeRes.json()) as { tree: GHTreeEntry[] };
    const prefix = `${slug}/`;
    const files = treeData.tree
      .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
      .map((e) => e.path.slice(prefix.length));

    spinner.stop();

    const emoji = meta.emoji ? `${meta.emoji} ` : "";
    console.log(`\n  ${emoji}${chalk.cyan.bold(meta.name)}`);
    console.log(`  ${meta.description}`);
    console.log(`  Slug: ${chalk.gray(slug)}`);
    console.log(`  Files: ${files.join(", ")}`);
    console.log(`  Source: ${chalk.gray(`https://github.com/${SKILLS_REPO}/tree/main/${slug}`)}`);

    // Print SKILL.md body (after frontmatter)
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
    if (body) {
      console.log(`\n${chalk.gray("─".repeat(60))}`);
      console.log(body);
    }

    console.log();
    hint(`Install: aisa skills install ${slug}`);
  } catch (err) {
    spinner.fail("Failed to load skill");
    error((err as Error).message);
  }
}

export async function skillsInstallAction(slug: string, options: { agent?: string }): Promise<void> {
  const spinner = ora(`Fetching skill '${slug}' from GitHub...`).start();

  try {
    const files = await fetchSkillFiles(slug);

    if (files.length === 0) {
      spinner.fail("Skill not found");
      error(`No skill "${slug}" in ${SKILLS_REPO}`);
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

    let installed = 0;
    for (const agent of targets) {
      const dir = expandHome(join(AGENT_DIRS[agent], slug));
      ensureDir(dir);
      writeSkillFiles(dir, files);
      console.log(`  ${chalk.green("✓")} ${AGENT_DIRS[agent]} (${agent})`);
      installed++;
    }

    success(`Skill '${slug}' installed to ${installed} agent(s)`);
  } catch (err) {
    spinner.fail("Failed to install skill");
    error((err as Error).message);
  }
}

export function skillsRemoveAction(slug: string, options: { agent?: string }): void {
  let targets: string[];
  if (options.agent && options.agent !== "all") {
    targets = [options.agent];
  } else {
    targets = Object.keys(AGENT_DIRS);
  }

  let removed = 0;
  for (const agent of targets) {
    const dir = expandHome(join(AGENT_DIRS[agent], slug));
    if (existsSync(dir)) {
      removeDir(dir);
      console.log(`  ${chalk.green("✓")} Removed from ${AGENT_DIRS[agent]}`);
      removed++;
    }
  }

  if (removed === 0) {
    console.log("  Skill not found in any agent directory.");
  } else {
    success(`Removed '${slug}' from ${removed} agent(s)`);
  }
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
