import ora from "ora";
import chalk from "chalk";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, success, badge, hint, truncate } from "../utils/display.js";
import { expandHome, ensureDir, writeSkillFiles, readSkillDir, removeDir, detectAgents } from "../utils/file.js";
import { AGENT_DIRS } from "../constants.js";
import type { SkillMeta, SkillDetail } from "../types.js";

// --- Skill Templates ---

const TEMPLATES: Record<string, string> = {
  default: `---
name: my-skill
description: "Describe what this skill does."
category: general
tags: []
metadata:
  aisa:
    apis: []
    requires:
      auth: true
      env: [AISA_API_KEY]
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
category: llm
tags: [llm, chat, openai, claude, gemini]
metadata:
  aisa:
    apis: [chat/completions, models]
    requires:
      auth: true
      env: [AISA_API_KEY]
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

## REST API (OpenAI-compatible)

\`\`\`bash
curl -X POST https://api.aisa.one/v1/chat/completions \\
  -H "Authorization: Bearer $AISA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4.1", "messages": [{"role": "user", "content": "Hello"}]}'
\`\`\`
`,

  search: `---
name: web-search
description: "Search the web, YouTube, and academic papers via AISA APIs."
category: search
tags: [search, web, youtube, scholar, tavily]
metadata:
  aisa:
    apis: [search/smart, search/full, youtube/search, scholar/search, tavily/search]
    requires:
      auth: true
      env: [AISA_API_KEY]
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

## Tavily Deep Search

\`\`\`bash
aisa run tavily /search -d '{"query": "NVIDIA earnings 2025", "search_depth": "advanced"}'
\`\`\`

## Tavily Extract (webpage content)

\`\`\`bash
aisa run tavily /extract -d '{"urls": ["https://example.com"]}'
\`\`\`
`,

  finance: `---
name: finance-analyst
description: "Access stock prices, earnings, SEC filings, and financial data via AISA."
category: finance
tags: [stocks, earnings, sec-filings, crypto, financial-analysis]
metadata:
  aisa:
    apis: [stock/price, analyst-estimates, financial-statements, filings, insider-trades, crypto/price]
    requires:
      auth: true
      env: [AISA_API_KEY]
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

## Stock Screener

\`\`\`bash
aisa screener --sector Technology --limit 20
\`\`\`

## Financial Statements

\`\`\`bash
aisa run financial-statements -q "symbol=AAPL&period=annual"
\`\`\`

## SEC Filings

\`\`\`bash
aisa run filings -q "symbol=TSLA&type=10-K"
\`\`\`

## Insider Trades

\`\`\`bash
aisa stock NVDA --field insider
\`\`\`
`,

  twitter: `---
name: twitter-manager
description: "Post tweets, search Twitter, get user profiles and trends via AISA."
category: twitter
tags: [twitter, tweets, social-media, trends]
metadata:
  aisa:
    apis: [twitter/create-tweet-v2, twitter/tweet/advanced-search, twitter/user/info, twitter/trends]
    requires:
      auth: true
      env: [AISA_API_KEY]
---

# Twitter Manager Skill

Interact with Twitter/X through AISA's Twitter APIs.

## Authentication

\`\`\`bash
export AISA_API_KEY=sk-your-key
\`\`\`

## Post a Tweet

\`\`\`bash
aisa tweet "Hello from AISA CLI!"
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

## Advanced: Get Tweet Replies

\`\`\`bash
aisa run twitter/tweet/replies -q "id=1234567890"
\`\`\`

## Advanced: Send DM

\`\`\`bash
aisa run twitter/send-dm-to-user -d '{"userId": "123", "text": "Hello!"}'
\`\`\`
`,

  video: `---
name: video-generator
description: "Generate videos from text prompts using AISA's video synthesis API."
category: video
tags: [video, generation, aigc, synthesis]
metadata:
  aisa:
    apis: [services/aigc/video-generation/video-synthesis, services/aigc/tasks]
    requires:
      auth: true
      env: [AISA_API_KEY]
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

export async function skillsListAction(options: { category?: string; limit?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching skills...").start();

  const query: Record<string, string> = {};
  if (options.category) query.category = options.category;
  if (options.limit) query.limit = options.limit;

  const res = await apiRequest<{ skills: SkillMeta[] }>(key, "cli/skills", { query });

  if (!res.success || !res.data) {
    spinner.fail("Failed to fetch skills");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const { skills } = res.data;

  if (skills.length === 0) {
    console.log("  No skills found.");
    return;
  }

  for (const s of skills) {
    const verified = s.verified ? chalk.green(" ✓") : "";
    console.log(`\n  ${chalk.cyan.bold(s.name)}${verified} ${chalk.gray(s.slug)} ${badge(s.category)}`);
    console.log(`  ${chalk.gray(truncate(s.description, 60))}`);
    console.log(`  ${chalk.gray(`${s.installs} installs`)}`);
  }
}

export async function skillsSearchAction(query: string, options: { limit?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Searching skills: "${query}"...`).start();

  const res = await apiRequest<{ skills: SkillMeta[] }>(key, "cli/skills/search", {
    method: "POST",
    body: { query, limit: parseInt(options.limit || "10") },
  });

  if (!res.success || !res.data) {
    spinner.fail("Search failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const { skills } = res.data;

  if (skills.length === 0) {
    console.log(`  No skills found for "${query}".`);
    return;
  }

  for (const s of skills) {
    const verified = s.verified ? chalk.green(" ✓") : "";
    console.log(`\n  ${chalk.cyan.bold(s.name)}${verified} ${chalk.gray(s.slug)} ${badge(s.category)}`);
    console.log(`  ${chalk.gray(s.description)}`);
  }

  console.log(chalk.gray("\n  Run 'aisa skills add <owner/name>' to install"));
}

export async function skillsShowAction(slug: string): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Loading ${slug}...`).start();

  const res = await apiRequest<SkillDetail>(key, `cli/skills/${slug}`);

  if (!res.success || !res.data) {
    spinner.fail("Skill not found");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const s = res.data;

  const verified = s.verified ? chalk.green(" ✓ verified") : "";
  console.log(`\n  ${chalk.cyan.bold(s.name)}${verified}`);
  console.log(`  ${s.description}`);
  console.log(`  Category: ${badge(s.category)}`);
  console.log(`  Tags: ${s.tags.join(", ")}`);
  console.log(`  Installs: ${s.installs}`);
  console.log(`  Files: ${s.files.map((f) => f.path).join(", ")}`);
  console.log(chalk.gray(`\n  Install: aisa skills add ${s.slug}`));
}

export async function skillsAddAction(slug: string, options: { agent?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Fetching skill '${slug}'...`).start();

  const res = await apiRequest<SkillDetail>(key, `cli/skills/${slug}`);

  if (!res.success || !res.data) {
    spinner.fail("Failed to fetch skill");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const skill = res.data;

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
    writeSkillFiles(dir, skill.files);
    console.log(`  ${chalk.green("✓")} ${AGENT_DIRS[agent]} (${agent})`);
    installed++;
  }

  success(`Skill '${skill.name}' installed to ${installed} agent(s)`);
}

export async function skillsRemoveAction(slug: string, options: { agent?: string }): Promise<void> {
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
  hint("Edit SKILL.md, then run 'aisa skills submit ./" + name + "'");
}

export async function skillsSubmitAction(path: string): Promise<void> {
  const key = requireApiKey();
  const dir = resolve(path);

  if (!existsSync(join(dir, "SKILL.md"))) {
    error("No SKILL.md found. Run 'aisa skills init <name>' first.");
    return;
  }

  const spinner = ora("Submitting skill...").start();
  const files = readSkillDir(dir);

  const res = await apiRequest<{ slug: string; status: string }>(key, "cli/skills", {
    method: "POST",
    body: { files },
  });

  if (!res.success || !res.data) {
    spinner.fail("Failed to submit skill");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  success(`Skill submitted: ${res.data.slug}`);
  hint(`Request verification: aisa skills request-verification ${res.data.slug}`);
}

export async function skillsPushAction(slug: string): Promise<void> {
  const key = requireApiKey();
  const dir = resolve(".");

  if (!existsSync(join(dir, "SKILL.md"))) {
    error("No SKILL.md in current directory.");
    return;
  }

  const spinner = ora(`Pushing updates to ${slug}...`).start();
  const files = readSkillDir(dir);

  const res = await apiRequest(key, `cli/skills/${slug}`, {
    method: "PUT",
    body: { files },
  });

  if (!res.success) {
    spinner.fail("Failed to push updates");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  success(`Skill '${slug}' updated.`);
}

export async function skillsVerifyAction(slug: string): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Requesting verification...").start();

  const res = await apiRequest(key, `cli/skills/${slug}/verify`, { method: "POST" });

  if (!res.success) {
    spinner.fail("Failed to request verification");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  success("Verification requested. The AISA team will review your skill.");
}

export async function skillsUpdateAction(slug?: string): Promise<void> {
  const key = requireApiKey();

  if (slug) {
    // Update single skill
    const spinner = ora(`Updating ${slug}...`).start();
    const res = await apiRequest<SkillDetail>(key, `cli/skills/${slug}`);

    if (!res.success || !res.data) {
      spinner.fail("Failed to fetch skill");
      error(res.error || "Unknown error");
      return;
    }

    spinner.stop();
    const skill = res.data;
    const targets = detectAgents(AGENT_DIRS);

    for (const agent of targets) {
      const dir = expandHome(join(AGENT_DIRS[agent], slug));
      if (existsSync(dir)) {
        writeSkillFiles(dir, skill.files);
        console.log(`  ${chalk.green("✓")} Updated in ${AGENT_DIRS[agent]}`);
      }
    }

    success(`Skill '${slug}' updated.`);
  } else {
    console.log("  Specify a skill to update: aisa skills update <owner/name>");
  }
}
