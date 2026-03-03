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

  const body: Record<string, unknown> = { tweet_text: text };
  if (options.replyTo) body.reply_to_tweet_id = options.replyTo;

  // Note: create_tweet_v2 requires login_cookies and proxy
  // This will fail without those - provide a helpful message
  const res = await apiRequest(key, "twitter/create_tweet_v2", {
    method: "POST",
    body,
    domain: true,
  });

  if (!res.success) {
    spinner.fail("Failed to post tweet");
    if (res.error?.includes("login_cookies")) {
      error("Tweet creation requires Twitter login cookies. See: https://docs.aisa.one");
    } else {
      error(res.error || "Unknown error");
    }
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

  const q: Record<string, string> = { query, queryType: "Latest" };
  if (options.limit) q.cursor = "";

  const res = await apiRequest(key, "twitter/tweet/advanced_search", {
    query: q,
    domain: true,
  });

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
    query: { userName: username },
    domain: true,
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
    const data = res.data as { data?: Record<string, unknown> };
    const user = data?.data;
    if (user) {
      console.log(`\n  ${chalk.cyan.bold(user.name as string)} ${chalk.gray(`@${user.userName}`)}`);
      if (user.description) console.log(`  ${user.description}`);
      console.log(`  ${chalk.white(String(user.followers))} followers · ${chalk.white(String(user.following))} following`);
      if (user.isBlueVerified) console.log(`  ${chalk.blue("✓ Verified")}`);
      if (user.location) console.log(`  ${chalk.gray(user.location as string)}`);
    } else {
      console.log(formatJson(res.data));
    }
  }
}

export async function twitterTrendsAction(options: { raw?: boolean }): Promise<void> {
  const key = requireApiKey();
  const spinner = ora("Fetching trends...").start();

  // woeid 1 = worldwide
  const res = await apiRequest(key, "twitter/trends", {
    query: { woeid: "1", count: "30" },
    domain: true,
  });

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
