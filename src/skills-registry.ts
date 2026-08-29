import { readCache, writeCache, touchCache } from "./cache.js";
import { pool } from "./utils/pool.js";
import { httpFetch, INFO_TIMEOUT_MS } from "./utils/http.js";

/**
 * GitHub-backed skill registry.
 *
 * The repo nests skills two levels deep (`<category>/<name>/SKILL.md`), so the
 * canonical slug is the repo-relative directory. Everything here is driven off
 * a single recursive tree fetch: api.github.com allows only 60 unauthenticated
 * requests per hour per IP, and the previous per-command fetching burned
 * several of those on every invocation.
 */

export const SKILLS_REPO = "AIsa-team/agent-skills";
const GH_API = `https://api.github.com/repos/${SKILLS_REPO}`;
export const GH_RAW = `https://raw.githubusercontent.com/${SKILLS_REPO}/main`;

const TREE_CACHE_KEY = "skills/tree.json";
const META_CACHE_KEY = "skills/meta.json";
const TREE_TTL_MS = 60 * 60 * 1000;
const META_TTL_MS = 30 * 24 * 60 * 60 * 1000; // keyed by blob sha, so effectively permanent
const FETCH_CONCURRENCY = 8;

interface GHTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

export interface SkillBlob {
  path: string;
  sha: string;
}

export interface SkillIndex {
  /** Canonical slugs (`<category>/<name>`), sorted. */
  slugs: string[];
  /** All blobs under each slug, including SKILL.md. */
  blobs: Record<string, SkillBlob[]>;
}

export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  emoji: string;
}

function ghHeaders(etag?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "aisa-cli",
  };
  // Raises the rate limit from 60/hr to 5000/hr when the user has one set.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers["If-None-Match"] = etag;
  return headers;
}

function buildIndex(tree: GHTreeEntry[]): SkillIndex {
  // A skill is any directory containing a SKILL.md, at whatever depth. Deriving
  // slugs from the SKILL.md locations rather than guessing at directory levels
  // is what keeps this working if the repo layout changes again.
  const slugs = tree
    .filter((e) => e.type === "blob" && e.path.endsWith("/SKILL.md"))
    .map((e) => e.path.slice(0, -"/SKILL.md".length))
    .sort();

  const blobs: Record<string, SkillBlob[]> = {};
  for (const slug of slugs) blobs[slug] = [];
  for (const entry of tree) {
    if (entry.type !== "blob") continue;
    // Longest matching slug wins, so a nested skill doesn't steal its parent's files.
    const owner = slugs
      .filter((s) => entry.path.startsWith(`${s}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (owner) blobs[owner].push({ path: entry.path, sha: entry.sha });
  }

  return { slugs, blobs };
}

let indexPromise: Promise<SkillIndex> | undefined;

/**
 * Fetch (or reuse) the skill index. Memoized per process on top of a 1h disk
 * cache with ETag revalidation, so repeated commands cost at most one
 * conditional request.
 */
export function getSkillIndex(options: { refresh?: boolean } = {}): Promise<SkillIndex> {
  if (options.refresh) indexPromise = undefined;
  if (!indexPromise) {
    indexPromise = loadSkillIndex(options.refresh).catch((err) => {
      indexPromise = undefined; // don't cache failures for the process lifetime
      throw err;
    });
  }
  return indexPromise;
}

async function loadSkillIndex(refresh?: boolean): Promise<SkillIndex> {
  const cached = readCache<SkillIndex>(TREE_CACHE_KEY);
  if (cached?.fresh && !refresh) return cached.data;

  let res: Response;
  try {
    res = await httpFetch(`${GH_API}/git/trees/main?recursive=1`, {
      headers: ghHeaders(refresh ? undefined : cached?.etag),
      idempotent: true,
      timeoutMs: INFO_TIMEOUT_MS,
    });
  } catch (err) {
    if (cached) return cached.data; // offline: stale beats nothing
    throw err;
  }

  if (res.status === 304 && cached) {
    touchCache(TREE_CACHE_KEY, TREE_TTL_MS);
    return cached.data;
  }

  if (!res.ok) {
    if (cached) return cached.data;
    const detail = res.status === 403 ? " (rate limited — set GITHUB_TOKEN to raise the limit)" : "";
    throw new Error(`GitHub API error: ${res.status}${detail}`);
  }

  const data = (await res.json()) as { tree: GHTreeEntry[]; truncated?: boolean };
  const index = buildIndex(data.tree || []);
  writeCache(TREE_CACHE_KEY, index, TREE_TTL_MS, res.headers.get("etag") || undefined);
  return index;
}

/** Last path segment — what the skill is called once installed. */
export function leafName(slug: string): string {
  return slug.split("/").pop() || slug;
}

/**
 * Accept either a canonical `<category>/<name>` slug or a bare name. A bare
 * name that matches several skills is an error rather than a guess: installing
 * the wrong skill silently is worse than asking.
 */
export function resolveSlug(input: string, index: SkillIndex): string {
  const clean = input.replace(/^\/+|\/+$/g, "");

  if (index.slugs.includes(clean)) return clean;

  const matches = index.slugs.filter((s) => leafName(s) === clean);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Ambiguous skill "${input}". Matches: ${matches.join(", ")}`);
  }
  throw new Error(`No skill "${input}" in ${SKILLS_REPO}`);
}

/** Parse YAML frontmatter from SKILL.md content. */
export function parseSkillFrontmatter(slug: string, content: string): SkillInfo {
  const info: SkillInfo = { slug, name: leafName(slug), description: "", emoji: "" };

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return info;

  const frontmatter = match[1];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (nameMatch) info.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");

  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) info.description = descMatch[1].trim().replace(/^["']|["']$/g, "");

  const metaMatch = frontmatter.match(/^metadata:\s*(.+)$/m);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      // agent-skills repo uses metadata.aisa; legacy skills used metadata.openclaw.
      info.emoji = meta?.aisa?.emoji || meta?.openclaw?.emoji || "";
    } catch {
      // ignore malformed metadata
    }
  }

  return info;
}

function skillMdBlob(slug: string, index: SkillIndex): SkillBlob | undefined {
  return index.blobs[slug]?.find((b) => b.path === `${slug}/SKILL.md`);
}

export async function fetchSkillMarkdown(slug: string): Promise<string> {
  const res = await httpFetch(`${GH_RAW}/${slug}/SKILL.md`, {
    idempotent: true,
    timeoutMs: INFO_TIMEOUT_MS,
  });
  if (!res.ok) throw new Error(`Cannot read ${slug}/SKILL.md: ${res.status}`);
  return res.text();
}

/**
 * Metadata for every skill. Cached by blob sha, so a warm cache needs zero
 * content requests and only re-fetches the skills that actually changed.
 */
export async function listSkills(index: SkillIndex): Promise<SkillInfo[]> {
  const cached = readCache<Record<string, SkillInfo>>(META_CACHE_KEY)?.data || {};
  const bySha: Record<string, SkillInfo> = { ...cached };

  const missing = index.slugs.filter((slug) => {
    const blob = skillMdBlob(slug, index);
    return blob ? !bySha[blob.sha] : false;
  });

  if (missing.length > 0) {
    const fetched = await pool(
      missing.map((slug) => async () => ({
        slug,
        content: await fetchSkillMarkdown(slug),
      })),
      FETCH_CONCURRENCY
    );
    for (const item of fetched) {
      if (!item) continue;
      const blob = skillMdBlob(item.slug, index);
      if (blob) bySha[blob.sha] = parseSkillFrontmatter(item.slug, item.content);
    }
    writeCache(META_CACHE_KEY, bySha, META_TTL_MS);
  }

  return index.slugs
    .map((slug) => {
      const blob = skillMdBlob(slug, index);
      const meta = blob ? bySha[blob.sha] : undefined;
      // Cached entries carry the slug they were first seen under; the current
      // one is authoritative if a skill moved between categories.
      return meta ? { ...meta, slug } : { slug, name: leafName(slug), description: "", emoji: "" };
    })
    .filter(Boolean);
}

export interface SkillFile {
  path: string;
  content: Buffer;
}

/**
 * Download every file in a skill directory. Content is kept as bytes: skills
 * may ship images or fonts, and decoding those as UTF-8 corrupts them.
 *
 * A partial download is an error, not a smaller skill. Installing replaces the
 * target directory, so silently dropping failed files would delete a working
 * skill and leave a broken one — possibly without its SKILL.md.
 */
export async function fetchSkillFiles(slug: string, index: SkillIndex): Promise<SkillFile[]> {
  const blobs = index.blobs[slug] || [];
  const prefix = `${slug}/`;

  const results = await pool(
    blobs.map((blob) => async (): Promise<SkillFile> => {
      const res = await httpFetch(`${GH_RAW}/${blob.path}`, {
        idempotent: true,
        timeoutMs: INFO_TIMEOUT_MS,
      });
      if (!res.ok) throw new Error(`${blob.path}: ${res.status}`);
      return {
        path: blob.path.slice(prefix.length),
        content: Buffer.from(await res.arrayBuffer()),
      };
    }),
    FETCH_CONCURRENCY
  );

  const missing = blobs.filter((_, i) => results[i] === undefined).map((b) => b.path);
  if (missing.length > 0) {
    throw new Error(
      `Could not download ${missing.length} of ${blobs.length} files for ${slug}: ${missing.join(", ")}`
    );
  }

  return results as SkillFile[];
}
