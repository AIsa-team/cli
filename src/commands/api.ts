import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, badge, table, hint, truncate } from "../utils/display.js";
import type { ApiGroup, ApiEndpoint } from "../types.js";

export async function apiListAction(options: { category?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Listing APIs...").start();

  const query: Record<string, string> = {};
  if (options.category) query.category = options.category;

  const res = await apiRequest<{ apis: ApiGroup[] }>(key, "cli/apis", { query });

  if (!res.success || !res.data) {
    spinner.fail("Failed to list APIs");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const { apis } = res.data;

  if (apis.length === 0) {
    console.log("  No APIs found.");
    return;
  }

  for (const api of apis) {
    console.log(`\n  ${chalk.cyan.bold(api.name)} ${chalk.gray(api.slug)} ${badge(api.category)}`);
    console.log(`  ${chalk.gray(api.description)}`);
    const shown = api.endpoints.slice(0, 3);
    for (const ep of shown) {
      console.log(`    ${chalk.yellow(ep.method.padEnd(6))} ${ep.path} ${chalk.gray("- " + truncate(ep.description, 50))}`);
    }
    if (api.endpoints.length > 3) {
      hint(`+${api.endpoints.length - 3} more endpoints`);
    }
  }

  console.log(chalk.gray("\n  Run 'aisa api show <slug>' for endpoint details"));
}

export async function apiSearchAction(query: string, options: { limit?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Searching "${query}"...`).start();

  const res = await apiRequest<{ apis: ApiGroup[] }>(key, "cli/apis/search", {
    method: "POST",
    body: { query, limit: parseInt(options.limit || "10") },
  });

  if (!res.success || !res.data) {
    spinner.fail("Search failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const { apis } = res.data;

  if (apis.length === 0) {
    console.log(`  No APIs found for "${query}".`);
    return;
  }

  for (const api of apis) {
    console.log(`\n  ${chalk.cyan.bold(api.name)} ${chalk.gray(api.slug)} ${badge(api.category)}`);
    console.log(`  ${chalk.gray(api.description)}`);
    for (const ep of api.endpoints.slice(0, 2)) {
      console.log(`    ${chalk.yellow(ep.method.padEnd(6))} ${ep.path}`);
    }
  }

  console.log(chalk.gray("\n  Run 'aisa run <slug> <path>' to execute"));
}

export async function apiShowAction(slug: string, path?: string): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Loading ${slug}${path ? " " + path : ""}...`).start();

  const endpoint = path ? `cli/apis/${slug}${path}` : `cli/apis/${slug}`;
  const res = await apiRequest<ApiGroup | ApiEndpoint>(key, endpoint);

  if (!res.success || !res.data) {
    spinner.fail("Failed to load API details");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const data = res.data;

  if ("endpoints" in data) {
    // ApiGroup
    console.log(`\n  ${chalk.cyan.bold(data.name)} ${badge(data.category)}`);
    console.log(`  ${data.description}\n`);
    for (const ep of data.endpoints) {
      console.log(`  ${chalk.yellow(ep.method.padEnd(6))} ${ep.path}`);
      console.log(`  ${chalk.gray(ep.description)}`);
    }
  } else {
    // ApiEndpoint with parameters
    console.log(`\n  ${chalk.yellow(data.method)} ${data.path}`);
    console.log(`  ${data.description}\n`);

    if (data.parameters && data.parameters.length > 0) {
      const rows = data.parameters.map((p) => [
        p.name,
        p.type,
        p.required ? chalk.red("required") : "optional",
        truncate(p.description, 40),
      ]);
      console.log(table(["Name", "Type", "Required", "Description"], rows));
    }

    console.log(chalk.gray(`\n  Example: aisa run ${slug} ${data.path} -q "param=value"`));
  }
}

export async function apiCodeAction(
  slug: string,
  path: string,
  options: { lang?: string }
): Promise<void> {
  const key = requireApiKey();
  const lang = options.lang || "typescript";
  const spinner = ora(`Generating ${lang} code...`).start();

  const res = await apiRequest<{ code: string; language: string }>(key, "cli/apis/code", {
    method: "POST",
    body: { slug, path, language: lang },
  });

  if (!res.success || !res.data) {
    spinner.fail("Failed to generate code");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  console.log(`\n${res.data.code}`);
}
