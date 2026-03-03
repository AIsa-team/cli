import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, badge } from "../utils/display.js";
import type { Model } from "../types.js";

export async function modelsListAction(options: { provider?: string }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching models...").start();

  const res = await apiRequest<{ data: Model[] }>(key, "models");

  if (!res.success || !res.data) {
    spinner.fail("Failed to fetch models");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();
  let models = res.data.data;

  // Filter by provider if specified
  if (options.provider) {
    const filter = options.provider.toLowerCase();
    models = models.filter((m) => m.owned_by?.toLowerCase().includes(filter));
  }

  if (models.length === 0) {
    console.log("  No models found.");
    return;
  }

  // Group by owned_by (provider)
  const grouped: Record<string, Model[]> = {};
  for (const m of models) {
    const p = m.owned_by || "other";
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

  console.log(`\n  ${chalk.cyan.bold(m.id)} ${badge(m.owned_by)}`);
  if (m.owned_by) console.log(`  Provider: ${m.owned_by}`);
  if (m.created) console.log(`  Created: ${new Date(m.created * 1000).toLocaleDateString()}`);
  if (m.supported_endpoint_types?.length) {
    console.log(`  Endpoints: ${m.supported_endpoint_types.join(", ")}`);
  }
  console.log(chalk.gray(`\n  Use: aisa chat "message" --model ${m.id}`));
}
