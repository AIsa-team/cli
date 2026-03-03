import ora from "ora";
import chalk from "chalk";
import { requireApiKey } from "../config.js";
import { apiRequest } from "../api.js";
import { error, formatJson } from "../utils/display.js";

export async function tweetAction(
  text: string,
  options: { replyTo?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Posting tweet...").start();

  const body: Record<string, unknown> = { text };
  if (options.replyTo) body.reply_to = options.replyTo;

  const res = await apiRequest(key, "twitter/create-tweet-v2", {
    method: "POST",
    body,
  });

  if (!res.success) {
    spinner.fail("Failed to post tweet");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(chalk.green("Tweet posted!"));
    console.log(formatJson(res.data));
  }
}

export async function twitterSearchAction(
  query: string,
  options: { limit?: string; raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Searching tweets: "${query}"...`).start();

  const q: Record<string, string> = { query };
  if (options.limit) q.limit = options.limit;

  const res = await apiRequest(key, "twitter/tweet/advanced-search", { query: q });

  if (!res.success) {
    spinner.fail("Twitter search failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(formatJson(res.data));
  }
}

export async function twitterUserAction(
  username: string,
  options: { raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(`Fetching @${username}...`).start();

  const res = await apiRequest(key, "twitter/user/info", {
    query: { username },
  });

  if (!res.success) {
    spinner.fail("Failed to fetch user");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(formatJson(res.data));
  }
}

export async function twitterTrendsAction(options: { raw?: boolean }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching trends...").start();

  const res = await apiRequest(key, "twitter/trends");

  if (!res.success) {
    spinner.fail("Failed to fetch trends");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  } else {
    console.log(formatJson(res.data));
  }
}
