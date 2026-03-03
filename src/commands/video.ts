import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson, success } from "../utils/display.js";
import type { VideoTask } from "../types.js";

export async function videoCreateAction(
  prompt: string,
  options: { model?: string; wait?: boolean; output?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Creating video generation task...").start();

  const body: Record<string, unknown> = { prompt };
  if (options.model) body.model = options.model;

  const res = await apiRequest<VideoTask>(key, "services/aigc/video-generation/video-synthesis", {
    method: "POST",
    body,
  });

  if (!res.success || !res.data) {
    spinner.fail("Failed to create video task");
    error(res.error || "Unknown error");
    return;
  }

  const task = res.data;
  spinner.stop();
  success(`Task created: ${task.taskId}`);

  if (!options.wait) {
    console.log(chalk.gray(`  Check status: aisa video status ${task.taskId}`));
    return;
  }

  // Poll for completion
  const pollSpinner = ora("Generating video...").start();
  let result: VideoTask = task;
  while (result.status === "pending" || result.status === "processing") {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await apiRequest<VideoTask>(key, `services/aigc/tasks/${result.taskId}`);
    if (!pollRes.success || !pollRes.data) {
      pollSpinner.fail("Failed to check status");
      error(pollRes.error || "Unknown error");
      return;
    }
    result = pollRes.data;
    pollSpinner.text = `Generating video... (${result.status})`;
  }

  if (result.status === "completed") {
    pollSpinner.succeed("Video generated!");
    if (result.resultUrl) {
      console.log(`  URL: ${chalk.cyan(result.resultUrl)}`);
    }
  } else {
    pollSpinner.fail(`Video generation ${result.status}`);
  }
}

export async function videoStatusAction(taskId: string, options: { raw?: boolean }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Checking status...").start();

  const res = await apiRequest<VideoTask>(key, `services/aigc/tasks/${taskId}`);

  if (!res.success || !res.data) {
    spinner.fail("Failed to check status");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    const t = res.data;
    console.log(`  Task:   ${t.taskId}`);
    console.log(`  Status: ${t.status}`);
    console.log(`  Prompt: ${t.prompt}`);
    if (t.resultUrl) console.log(`  URL:    ${chalk.cyan(t.resultUrl)}`);
  }
}
