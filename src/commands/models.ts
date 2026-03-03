import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, badge, table } from "../utils/display.js";
import type { Model } from "../types.js";

export async function modelsListAction(options: { provider?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching models...").start();

  const query: Record<string, string> = {};
  if (options.provider) query.provider = options.provider;

  const res = await apiRequest<{ data: Model[] }>(key, "models", { query });

  if (!res.success || !res.data) {
    spinner.fail("Failed to fetch models");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const models = res.data.data;

  if (models.length === 0) {
    console.log("  No models found.");
    return;
  }

  // Group by provider
  const grouped: Record<string, Model[]> = {};
  for (const m of models) {
    const p = m.provider || "other";
    if (!grouped[p]) grouped[p] = [];
    grouped[p].push(m);
  }

  for (const [provider, pModels] of Object.entries(grouped)) {
    console.log(`\n  ${chalk.cyan.bold(provider.toUpperCase())}`);
    for (const m of pModels) {
      console.log(`    ${chalk.white(m.id)}`);
    }
  }

  console.log(chalk.gray(`\n  ${models.length} models available`));
  console.log(chalk.gray("  Run 'aisa models show <model-id>' for details"));
}

export async function modelsShowAction(modelId: string): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Loading ${modelId}...`).start();

  const res = await apiRequest<Model>(key, `models/${modelId}`);

  if (!res.success || !res.data) {
    spinner.fail("Model not found");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  const m = res.data;

  console.log(`\n  ${chalk.cyan.bold(m.name)} ${badge(m.provider)}`);
  console.log(`  ID: ${m.id}`);
  if (m.contextWindow) console.log(`  Context: ${(m.contextWindow / 1000).toFixed(0)}k tokens`);
  if (m.maxTokens) console.log(`  Max output: ${(m.maxTokens / 1000).toFixed(0)}k tokens`);
  if (m.pricing) {
    console.log(`  Pricing: $${m.pricing.input}/M input, $${m.pricing.output}/M output`);
  }
  if (m.capabilities?.length) {
    console.log(`  Capabilities: ${m.capabilities.join(", ")}`);
  }
  console.log(chalk.gray(`\n  Use: aisa chat "message" --model ${m.id}`));
}
