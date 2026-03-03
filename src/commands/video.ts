import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson, success } from "../utils/display.js";

interface VideoTaskResponse {
  output?: {
    task_id?: string;
    task_status?: string;
    video_url?: string;
  };
  request_id?: string;
  // Alternate response shape
  taskId?: string;
  status?: string;
  resultUrl?: string;
}

export async function videoCreateAction(
  prompt: string,
  options: { model?: string; wait?: boolean; output?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Creating video generation task...").start();

  const body: Record<string, unknown> = {
    model: options.model || "wan2.6-t2v",
    input: { prompt },
    parameters: { resolution: "720P", duration: 5 },
  };

  const res = await apiRequest<VideoTaskResponse>(key, "services/aigc/video-generation/video-synthesis", {
    method: "POST",
    body,
    headers: { "X-DashScope-Async": "enable" },
    domain: true,
  });

  if (!res.success || !res.data) {
    spinner.fail("Failed to create video task");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  const taskId = res.data.output?.task_id || res.data.taskId;
  if (!taskId) {
    console.log(formatJson(res.data));
    return;
  }

  success(`Task created: ${taskId}`);

  if (!options.wait) {
    console.log(chalk.gray(`  Check status: aisa video status ${taskId}`));
    return;
  }

  // Poll for completion
  const pollSpinner = ora("Generating video...").start();
  let status = "PENDING";
  let lastPollData: VideoTaskResponse | undefined;
  while (status === "PENDING" || status === "RUNNING") {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await apiRequest<VideoTaskResponse>(key, "services/aigc/tasks", {
      query: { task_id: taskId },
      domain: true,
    });

    if (!pollRes.success || !pollRes.data) {
      pollSpinner.fail("Failed to check status");
      error(pollRes.error || "Unknown error");
      return;
    }

    lastPollData = pollRes.data;
    status = lastPollData.output?.task_status || lastPollData.status || "UNKNOWN";
    pollSpinner.text = `Generating video... (${status})`;
  }

  if (status === "SUCCEEDED" || status === "completed") {
    pollSpinner.succeed("Video generated!");
    const videoUrl = lastPollData?.output?.video_url || lastPollData?.resultUrl;
    if (videoUrl) {
      console.log(`  URL: ${chalk.cyan(videoUrl)}`);
    }
  } else {
    pollSpinner.fail(`Video generation failed: ${status}`);
  }
}

export async function videoStatusAction(taskId: string, options: { raw?: boolean }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Checking status...").start();

  const res = await apiRequest<VideoTaskResponse>(key, "services/aigc/tasks", {
    query: { task_id: taskId },
    domain: true,
  });

  if (!res.success || !res.data) {
    spinner.fail("Failed to check status");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    const d = res.data;
    const status = d.output?.task_status || d.status || "unknown";
    const id = d.output?.task_id || d.taskId || taskId;
    const videoUrl = d.output?.video_url || d.resultUrl;

    console.log(`  Task:   ${id}`);
    console.log(`  Status: ${status}`);
    if (videoUrl) console.log(`  URL:    ${chalk.cyan(videoUrl)}`);
    if (d.request_id) console.log(`  Request: ${chalk.gray(d.request_id)}`);
  }
}
