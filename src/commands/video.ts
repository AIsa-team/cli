import { writeFile } from "node:fs/promises";
import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson, hint, success } from "../utils/display.js";
import {
  DEFAULT_VIDEO_MODEL,
  MEDIA_TYPES,
  VIDEO_MODELS,
  videoModelSpec,
  type MediaType,
} from "../constants.js";

/** Shape returned by both POST /v1/video/generations and the status endpoint. */
interface VideoTask {
  id?: string;
  object?: string;
  status?: string;
  model?: string;
  created_at?: number;
  completed_at?: number;
  progress?: string;
  result?: unknown;
  error?: { message?: string };
}

/** Statuses after which the task will never change again. */
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 15 * 60 * 1000;

const VIDEO_KEY = /video.*url|url.*video/i;
const URL_KEY = /url$/i;
/** Keys that carry a still image rather than the clip — thumbnails end in "url" too. */
const NOT_VIDEO_KEY = /thumb|cover|preview|poster|image|img|icon|logo|snapshot|avatar|first_frame|last_frame/i;

function searchUrl(
  value: unknown,
  keyMatches: (key: string) => boolean,
  depth = 0
): string | undefined {
  if (depth > 8 || value == null) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchUrl(item, keyMatches, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof value !== "object") return undefined;

  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, val] of entries) {
    if (typeof val === "string" && keyMatches(key) && /^https?:\/\//.test(val)) return val;
  }
  for (const [, val] of entries) {
    const found = searchUrl(val, keyMatches, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Each upstream nests the finished video somewhere different (DashScope puts it
 * at result.output.video_url, Seedance under result.data[].content[].url), so
 * search rather than hardcode a path.
 *
 * Every pass covers the whole tree before the next one starts, and each is
 * narrower than a plain "ends in url" match would be. Responses ship thumbnails
 * and cover images beside the clip, and `thumbnail_url` both ends in "url" and
 * tends to sit closer to the root than the video does — matching it would make
 * `--output` download a still image.
 */
export function findVideoUrl(value: unknown): string | undefined {
  // The still-image exclusion applies to every pass: `video_thumbnail_url`
  // matches the video-named pattern too, and saving it via --output would hand
  // the user a JPEG with an .mp4 name.
  return (
    // 1. Explicitly video-named: output.video_url
    searchUrl(value, (k) => VIDEO_KEY.test(k) && !NOT_VIDEO_KEY.test(k)) ??
    // 2. A bare `url`, which is what a media-item object uses: content[].url
    searchUrl(value, (k) => k.toLowerCase() === "url") ??
    // 3. Any other *_url, minus the ones that name a still image
    searchUrl(value, (k) => URL_KEY.test(k) && !NOT_VIDEO_KEY.test(k))
  );
}

function printTask(task: VideoTask, fallbackId?: string): void {
  const url = task.result ? findVideoUrl(task.result) : undefined;
  console.log(`  Task:   ${task.id || fallbackId}`);
  console.log(`  Status: ${task.status || "unknown"}`);
  if (task.model) console.log(`  Model:  ${task.model}`);
  if (task.progress && !TERMINAL_STATUSES.has(task.status || "")) {
    console.log(`  Progress: ${task.progress}`);
  }
  if (url) console.log(`  URL:    ${chalk.cyan(url)}`);
  if (task.error?.message) console.log(`  Error:  ${chalk.red(task.error.message)}`);
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, buffer);
}

export interface MediaInput {
  type: MediaType;
  url: string;
}

/** Parse `--media first_frame=https://…`, and bare URLs from `--image`. */
export function parseMedia(specs: string[] = [], images: string[] = []): MediaInput[] {
  const media: MediaInput[] = images.map((url) => ({ type: "first_frame" as MediaType, url }));

  for (const spec of specs) {
    const eq = spec.indexOf("=");
    if (eq < 0) {
      throw new Error(`Invalid --media "${spec}". Use type=url, e.g. first_frame=https://…`);
    }
    const type = spec.slice(0, eq) as MediaType;
    const url = spec.slice(eq + 1);
    if (!MEDIA_TYPES.includes(type)) {
      throw new Error(`Unknown media type "${type}". Valid: ${MEDIA_TYPES.join(", ")}`);
    }
    if (!url) throw new Error(`Missing URL in --media "${spec}"`);
    media.push({ type, url });
  }

  return media;
}

/**
 * Build the request body for a model's vendor. The gateway rewrites only the
 * top-level `model` and forwards the rest verbatim, so a Bailian body sent to a
 * Seedance model is rejected with a 400.
 */
export function buildVideoBody(
  model: string,
  prompt: string,
  media: MediaInput[],
  options: { resolution?: string; duration?: string }
): Record<string, unknown> {
  const spec = videoModelSpec(model);

  if (spec.family === "seedance") {
    // BytePlus takes a multimodal content array rather than input/parameters.
    return {
      model,
      content: [
        { type: "text", text: prompt },
        ...media.map((m) => ({ type: "image_url", image_url: { url: m.url } })),
      ],
    };
  }

  return {
    model,
    input: { prompt, ...(media.length > 0 ? { media } : {}) },
    parameters: {
      resolution: options.resolution || "720P",
      duration: options.duration ? parseInt(options.duration) : 5,
    },
  };
}

/**
 * Parse a `--body` payload. The option means "send this verbatim", so the model
 * it names wins over the CLI's default — only an explicit `--model` overrides
 * it. Anything else would silently redirect a valid request to another model.
 */
export function parseBodyOverride(raw: string, explicitModel?: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("--body must be valid JSON");
  }
  // JSON.parse accepts null, arrays and numbers; none of them are request bodies.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--body must be a JSON object");
  }

  const body = { ...(parsed as Record<string, unknown>) };
  if (explicitModel) body.model = explicitModel;
  else if (!body.model) body.model = DEFAULT_VIDEO_MODEL;
  return body;
}

export async function videoCreateAction(
  prompt: string,
  options: {
    model?: string;
    wait?: boolean;
    output?: string;
    raw?: boolean;
    resolution?: string;
    duration?: string;
    image?: string[];
    media?: string[];
    body?: string;
  }
): Promise<void> {
  const key = requireApiKey();

  let body: Record<string, unknown>;

  if (options.body) {
    // Escape hatch for shapes the CLI does not model; the gateway is a pass-through.
    try {
      body = parseBodyOverride(options.body, options.model);
    } catch (err) {
      error((err as Error).message);
      return;
    }
  } else {
    const model = options.model || DEFAULT_VIDEO_MODEL;
    const spec = videoModelSpec(model);

    let media: MediaInput[];
    try {
      media = parseMedia(options.media, options.image);
    } catch (err) {
      error((err as Error).message);
      return;
    }

    // Image- and clip-driven models are accepted at submission time and only
    // fail a minute later, after billing. Refuse before spending anything —
    // and check for the type the model actually wants, since supplying a
    // first_clip to an i2v model fails exactly the same way as supplying none.
    if (spec.requiresMedia && !media.some((m) => m.type === spec.requiresMedia)) {
      const shorthand = spec.requiresMedia === "first_frame" ? " (or --image <url>)" : "";
      error(
        media.length === 0
          ? `${model} needs source media.`
          : `${model} needs ${spec.requiresMedia} media, got ${media.map((m) => m.type).join(", ")}.`
      );
      hint(`Pass --media ${spec.requiresMedia}=<url>${shorthand}`);
      return;
    }
    if (spec.family === "seedance" && media.length > 0) {
      hint("Seedance media handling is unverified — use --body if the request is rejected");
    }

    body = buildVideoBody(model, prompt, media, options);
  }

  const spinner = ora("Creating video generation task...").start();

  const res = await apiRequest<VideoTask>(key, "video/generations", {
    method: "POST",
    body,
  });

  if (!res.success || !res.data) {
    spinner.fail("Failed to create video task");
    error(res.error || "Unknown error");
    if ((res.error || "").includes("model not found")) {
      hint(`Available video models: ${Object.keys(VIDEO_MODELS).join(", ")}`);
    }
    return;
  }

  spinner.stop();

  const taskId = res.data.id;

  // --raw changes the output format; it must not cancel work the user asked
  // for. Only skip polling when nothing was requested beyond submission.
  if (!options.wait || !taskId) {
    if (options.raw) {
      console.log(JSON.stringify(res.data));
      return;
    }
    if (!taskId) {
      console.log(formatJson(res.data));
      return;
    }
    success(`Task created: ${taskId}`);
    hint(`Check status: aisa video status ${taskId}`);
    return;
  }

  if (!options.raw) success(`Task created: ${taskId}`);

  const pollSpinner = options.raw ? undefined : ora("Generating video...").start();
  const deadline = Date.now() + MAX_WAIT_MS;
  let task: VideoTask = res.data;

  while (!TERMINAL_STATUSES.has(task.status || "")) {
    if (Date.now() > deadline) {
      pollSpinner?.warn(`Still ${task.status || "pending"} after 15 minutes — giving up on waiting`);
      if (options.raw) console.log(JSON.stringify(task));
      else hint(`Check later: aisa video status ${taskId}`);
      return;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await apiRequest<VideoTask>(key, `video/generations/${taskId}`);
    if (!pollRes.success || !pollRes.data) {
      pollSpinner?.fail("Failed to check status");
      error(pollRes.error || "Unknown error");
      return;
    }

    task = pollRes.data;
    if (pollSpinner) {
      pollSpinner.text = `Generating video... (${task.status}${task.progress ? ` ${task.progress}` : ""})`;
    }
  }

  const videoUrl = findVideoUrl(task.result);

  if (task.status !== "completed") {
    pollSpinner?.fail(`Video generation ${task.status}`);
    if (options.raw) console.log(JSON.stringify(task));
    else if (task.error?.message) error(task.error.message);
    return;
  }

  pollSpinner?.succeed("Video generated!");

  if (options.output) {
    await download(videoUrl, options.output, options.raw);
  }

  if (options.raw) {
    console.log(JSON.stringify(task));
    return;
  }

  if (videoUrl) console.log(`  URL: ${chalk.cyan(videoUrl)}`);
  else console.log(formatJson(task.result));
}

/** Download to `output`, reporting through a spinner unless output is raw JSON. */
async function download(
  videoUrl: string | undefined,
  output: string,
  raw?: boolean
): Promise<void> {
  if (!videoUrl) {
    error("No video URL available to download");
    return;
  }
  const spinner = raw ? undefined : ora(`Downloading to ${output}...`).start();
  try {
    await downloadVideo(videoUrl, output);
    spinner?.succeed(`Saved to ${output}`);
  } catch (err) {
    const message = `Download failed: ${(err as Error).message}`;
    if (spinner) spinner.fail(message);
    else error(message);
  }
}

export async function videoStatusAction(
  taskId: string,
  options: { raw?: boolean; output?: string }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Checking status...").start();

  const res = await apiRequest<VideoTask>(key, `video/generations/${taskId}`);

  if (!res.success || !res.data) {
    spinner.fail("Failed to check status");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  // --raw selects the output format; it must not skip a requested download.
  if (options.output) {
    await download(findVideoUrl(res.data.result), options.output, options.raw);
  }

  if (options.raw) {
    console.log(JSON.stringify(res.data));
    return;
  }

  printTask(res.data, taskId);
}
