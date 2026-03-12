import ora from "ora";
import chalk from "chalk";
import fetch from "node-fetch";
import { requireApiKey, getConfig, setConfig } from "../config.js";
import { apiRequest } from "../api.js";
import { APIS_BASE_URL } from "../constants.js";
import { error, success, formatJson } from "../utils/display.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CookieAuth {
  login_cookies: string;
  proxy?: string;
}

function requireCookies(): CookieAuth {
  const cookies = getConfig("twitterCookies") as string;
  const proxy = getConfig("twitterProxy") as string;
  if (!cookies) {
    error(
      'No Twitter cookies configured. Run "aisa twitter login" or "aisa config set twitterCookies <value>".'
    );
    process.exit(1);
  }
  const auth: CookieAuth = { login_cookies: cookies };
  if (proxy) auth.proxy = proxy;
  return auth;
}

/** Simple GET against a twitter read endpoint. */
async function twitterGet<T = unknown>(
  endpoint: string,
  query: Record<string, string>,
  label: string,
  options: { raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const spinner = ora(label).start();

  const res = await apiRequest<T>(key, endpoint, {
    query,
    domain: true,
  });

  if (!res.success) {
    spinner.fail(label.replace(/\.{3}$/, " failed"));
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

/** POST against a twitter write endpoint (auto-injects cookies/proxy). */
async function twitterWrite<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  label: string,
  options: { raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const auth = requireCookies();
  const spinner = ora(label).start();

  const res = await apiRequest<T>(key, endpoint, {
    method: "POST",
    body: { ...auth, ...body },
    domain: true,
  });

  if (!res.success) {
    spinner.fail(label.replace(/\.{3}$/, " failed"));
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

// ── Read: User Endpoints ─────────────────────────────────────────────────────

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
      console.log(
        `\n  ${chalk.cyan.bold(user.name as string)} ${chalk.gray(`@${user.userName}`)}`
      );
      if (user.description) console.log(`  ${user.description}`);
      console.log(
        `  ${chalk.white(String(user.followers))} followers · ${chalk.white(String(user.following))} following`
      );
      if (user.isBlueVerified) console.log(`  ${chalk.blue("✓ Verified")}`);
      if (user.location) console.log(`  ${chalk.gray(user.location as string)}`);
    } else {
      console.log(formatJson(res.data));
    }
  }
}

export async function twitterUserAboutAction(
  username: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/user_about",
    { userName: username },
    `Fetching about @${username}...`,
    options
  );
}

export async function twitterBatchUsersAction(
  ids: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/user/batch_info_by_ids",
    { userIds: ids },
    "Fetching users...",
    options
  );
}

export async function twitterUserTweetsAction(
  username: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { userName: username };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/user/last_tweets",
    q,
    `Fetching tweets by @${username}...`,
    options
  );
}

export async function twitterMentionsAction(
  username: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { userName: username };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/user/mentions",
    q,
    `Fetching mentions of @${username}...`,
    options
  );
}

export async function twitterFollowersAction(
  username: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { userName: username };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/user/followers",
    q,
    `Fetching followers of @${username}...`,
    options
  );
}

export async function twitterFollowingAction(
  username: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { userName: username };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/user/followings",
    q,
    `Fetching following of @${username}...`,
    options
  );
}

export async function twitterVerifiedFollowersAction(
  userId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { user_id: userId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/user/verifiedFollowers",
    q,
    "Fetching verified followers...",
    options
  );
}

export async function twitterCheckFollowAction(
  source: string,
  target: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/user/check_follow_relationship",
    { source_user_name: source, target_user_name: target },
    `Checking follow relationship @${source} → @${target}...`,
    options
  );
}

export async function twitterUserSearchAction(
  query: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { query };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/user/search",
    q,
    `Searching users: "${query}"...`,
    options
  );
}

// ── Read: Tweet Endpoints ────────────────────────────────────────────────────

export async function twitterSearchAction(
  query: string,
  options: { limit?: string; type?: string; raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = {
    query,
    queryType: options.type === "top" ? "Top" : "Latest",
  };
  if (options.cursor) q.cursor = options.cursor;
  if (options.limit) q.count = options.limit;
  return twitterGet(
    "twitter/tweet/advanced_search",
    q,
    `Searching tweets: "${query}"...`,
    options
  );
}

export async function twitterDetailAction(
  ids: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/tweets",
    { tweet_ids: ids },
    "Fetching tweet details...",
    options
  );
}

export async function twitterRepliesAction(
  tweetId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { tweetId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/tweet/replies",
    q,
    "Fetching replies...",
    options
  );
}

export async function twitterQuotesAction(
  tweetId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { tweetId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/tweet/quotes",
    q,
    "Fetching quotes...",
    options
  );
}

export async function twitterRetweetersAction(
  tweetId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { tweetId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/tweet/retweeters",
    q,
    "Fetching retweeters...",
    options
  );
}

export async function twitterThreadAction(
  tweetId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { tweetId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/tweet/thread_context",
    q,
    "Fetching thread...",
    options
  );
}

export async function twitterArticleAction(
  tweetId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/article",
    { tweet_id: tweetId },
    "Fetching article...",
    options
  );
}

// ── Read: Trends ─────────────────────────────────────────────────────────────

export async function twitterTrendsAction(options: {
  woeid?: string;
  count?: string;
  raw?: boolean;
}): Promise<void> {
  const q: Record<string, string> = {
    woeid: options.woeid || "1",
    count: options.count || "30",
  };
  return twitterGet("twitter/trends", q, "Fetching trends...", options);
}

// ── Read: Lists ──────────────────────────────────────────────────────────────

export async function twitterListMembersAction(
  listId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { list_id: listId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/list/members",
    q,
    "Fetching list members...",
    options
  );
}

export async function twitterListFollowersAction(
  listId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { list_id: listId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/list/followers",
    q,
    "Fetching list followers...",
    options
  );
}

// ── Read: Communities ────────────────────────────────────────────────────────

export async function twitterCommunityInfoAction(
  communityId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/community/info",
    { community_id: communityId },
    "Fetching community info...",
    options
  );
}

export async function twitterCommunityMembersAction(
  communityId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { community_id: communityId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/community/members",
    q,
    "Fetching community members...",
    options
  );
}

export async function twitterCommunityModsAction(
  communityId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { community_id: communityId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/community/moderators",
    q,
    "Fetching community moderators...",
    options
  );
}

export async function twitterCommunityTweetsAction(
  communityId: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { community_id: communityId };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/community/tweets",
    q,
    "Fetching community tweets...",
    options
  );
}

export async function twitterCommunitySearchAction(
  query: string,
  options: { raw?: boolean; cursor?: string }
): Promise<void> {
  const q: Record<string, string> = { query };
  if (options.cursor) q.cursor = options.cursor;
  return twitterGet(
    "twitter/community/get_tweets_from_all_community",
    q,
    `Searching community tweets: "${query}"...`,
    options
  );
}

// ── Read: Spaces ─────────────────────────────────────────────────────────────

export async function twitterSpaceAction(
  spaceId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterGet(
    "twitter/spaces/detail",
    { space_id: spaceId },
    "Fetching space details...",
    options
  );
}

// ── Write: Login / Logout ────────────────────────────────────────────────────

export async function twitterLoginAction(options: {
  username?: string;
  email?: string;
  password?: string;
  proxy?: string;
  totp?: string;
  cookies?: string;
  raw?: boolean;
}): Promise<void> {
  // Direct cookie import mode
  if (options.cookies) {
    setConfig("twitterCookies", options.cookies);
    if (options.proxy) setConfig("twitterProxy", options.proxy);
    success("Twitter cookies saved." + (options.proxy ? " Proxy saved." : ""));
    return;
  }

  // Login via API
  if (!options.username || !options.password) {
    error("Required: --username, --password (and optionally --email, --proxy, --totp)");
    process.exit(1);
  }

  const key = requireApiKey();
  const spinner = ora("Logging in to Twitter...").start();

  const body: Record<string, string> = {
    user_name: options.username,
    password: options.password,
  };
  if (options.proxy) body.proxy = options.proxy;
  if (options.email) body.email = options.email;
  if (options.totp) body.totp_secret = options.totp;

  const res = await apiRequest<{ login_cookies?: string }>(
    key,
    "twitter/user_login_v2",
    { method: "POST", body, domain: true }
  );

  if (!res.success) {
    spinner.fail("Twitter login failed");
    error(res.error || "Unknown error");
    return;
  }

  spinner.stop();

  // Extract and store cookies
  const data = res.data as Record<string, unknown>;
  const cookies =
    (data?.login_cookies as string) ||
    (data?.data as Record<string, unknown>)?.login_cookies as string | undefined;

  if (cookies) {
    setConfig("twitterCookies", cookies);
    if (options.proxy) setConfig("twitterProxy", options.proxy);
    success("Logged in! Cookies saved." + (options.proxy ? " Proxy saved." : ""));
  } else {
    console.log(chalk.yellow("Login response did not contain login_cookies. Raw response:"));
    console.log(formatJson(res.data));
  }

  if (options.raw) {
    console.log(JSON.stringify(res.data));
  }
}

export function twitterLogoutAction(): void {
  setConfig("twitterCookies", "");
  setConfig("twitterProxy", "");
  success("Twitter cookies and proxy cleared.");
}

// ── Write: Tweet ─────────────────────────────────────────────────────────────

export async function tweetAction(
  text: string,
  options: { replyTo?: string; mediaIds?: string; raw?: boolean }
): Promise<void> {
  const body: Record<string, unknown> = { tweet_text: text };
  if (options.replyTo) body.reply_to_tweet_id = options.replyTo;
  if (options.mediaIds) body.media_ids = options.mediaIds.split(",");
  return twitterWrite("twitter/create_tweet_v2", body, "Posting tweet...", options);
}

// ── Write: Like / Unlike ─────────────────────────────────────────────────────

export async function twitterLikeAction(
  tweetId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/like_tweet_v2",
    { tweet_id: tweetId },
    "Liking tweet...",
    options
  );
}

export async function twitterUnlikeAction(
  tweetId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/unlike_tweet_v2",
    { tweet_id: tweetId },
    "Unliking tweet...",
    options
  );
}

// ── Write: Retweet ───────────────────────────────────────────────────────────

export async function twitterRetweetAction(
  tweetId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/retweet_tweet_v2",
    { tweet_id: tweetId },
    "Retweeting...",
    options
  );
}

// ── Write: Delete ────────────────────────────────────────────────────────────

export async function twitterDeleteAction(
  tweetId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/delete_tweet_v2",
    { tweet_id: tweetId },
    "Deleting tweet...",
    options
  );
}

// ── Write: Follow / Unfollow ─────────────────────────────────────────────────

export async function twitterFollowAction(
  userId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/follow_user_v2",
    { user_id: userId },
    "Following user...",
    options
  );
}

export async function twitterUnfollowAction(
  userId: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/unfollow_user_v2",
    { user_id: userId },
    "Unfollowing user...",
    options
  );
}

// ── Write: Upload Media ──────────────────────────────────────────────────────

export async function twitterUploadMediaAction(
  filePath: string,
  options: { raw?: boolean }
): Promise<void> {
  const key = requireApiKey();
  const auth = requireCookies();
  const spinner = ora("Uploading media...").start();

  let formData: InstanceType<typeof globalThis.FormData>;
  try {
    const { FormData: NFFormData, fileFromSync } = await import("node-fetch");
    formData = new NFFormData();
    formData.append("file", fileFromSync(filePath));
  } catch {
    spinner.fail("Failed to read file");
    error(`Could not read file: ${filePath}`);
    return;
  }
  formData.append("login_cookies", auth.login_cookies);
  if (auth.proxy) formData.append("proxy", auth.proxy);

  const url = `${APIS_BASE_URL}/twitter/upload_media_v2`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "x-aisa-source": "cli",
    },
    body: formData,
  });

  if (!res.ok) {
    spinner.fail("Upload failed");
    const text = await res.text();
    error(`${res.status}: ${text}`);
    return;
  }

  const data = await res.json();
  spinner.stop();

  if (options.raw) {
    console.log(JSON.stringify(data));
  } else {
    success("Media uploaded!");
    console.log(formatJson(data));
  }
}

// ── Write: Direct Message ────────────────────────────────────────────────────

export async function twitterDmAction(
  userId: string,
  text: string,
  options: { raw?: boolean }
): Promise<void> {
  return twitterWrite(
    "twitter/send_dm_to_user",
    { user_id: userId, text },
    "Sending DM...",
    options
  );
}
