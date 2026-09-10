import Conf from "conf";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { createHash, randomUUID } from "node:crypto";
import { httpFetch } from "./utils/http.js";
import { AUTH_SERVER, MISSING_API_KEY_GUIDANCE, ENV_VAR_NAME } from "./constants.js";

// tokens.json is authoritative; conf is a write-only compatibility mirror.
const aisaDir = () => join(homedir(), ".aisa");
const keyFile = () => join(aisaDir(), "key");
const tokenFile = () => join(aisaDir(), "tokens.json");

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** Unix timestamp in milliseconds. */
  expiresAt?: number;
  clientId?: string;
}

// Only call under withTokenLock, except the read-only source indicator.
function readTokenFile(): StoredTokens | undefined {
  try {
    const tokens = JSON.parse(readFileSync(tokenFile(), "utf-8"));
    if (typeof tokens?.accessToken !== "string" || !tokens.accessToken) throw new Error("Invalid token file. Restore it before changing credentials.");
    return tokens;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function readLegacyKey(): string | undefined {
  try { return readFileSync(keyFile(), "utf-8").trim() || undefined; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function readTokens(): StoredTokens | undefined {
  const tokens = readTokenFile();
  if (tokens) return tokens;
  const accessToken = readLegacyKey();
  if (!accessToken) return undefined;
  const migrated = { accessToken };
  writeTokens(migrated);
  return migrated;
}

async function withTokenLock<T>(work: () => Promise<T> | T): Promise<T> {
  mkdirSync(aisaDir(), { recursive: true });
  let compromised: Error | undefined;
  const release = await lockfile.lock(tokenFile(), {
    realpath: false,
    stale: 30_000,
    update: 1_000,
    retries: { retries: 400, factor: 1, minTimeout: 100, maxTimeout: 100 },
    onCompromised: (error) => { compromised = error; },
  });
  // Fail closed before any writes if a suspended process loses its lease.
  const previousGuard = assertTokenLock;
  assertTokenLock = () => { if (compromised) throw compromised; };
  try { return await work(); }
  finally {
    assertTokenLock = previousGuard;
    await release();
  }
}

let assertTokenLock = () => {};
const rotationFile = () => join(aisaDir(), ".token-rotation.json");
const pendingFile = () => join(aisaDir(), ".pending-tokens.json");
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function writeJson(path: string, value: unknown): void {
  assertTokenLock();
  writeIndependentJson(path, value);
}

// Unique recovery files do not share a name and can be created without the main lock.
function writeIndependentJson(path: string, value: unknown): void {
  mkdirSync(aisaDir(), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function removeFile(path: string): void {
  assertTokenLock();
  try { unlinkSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * 0600, because this file holds credentials.
 *
 * conf defaults to 0o666 (0644 after a typical umask), so until 2026-08-24
 * every install left the API key — and the Twitter session cookies, which are
 * account access rather than something revocable — world-readable on shared
 * machines. The key file next door was already 0600; this closes the gap on
 * the store that mirrors it.
 *
 * The mirror itself stays: published CLIs up to 0.3.0 know nothing about
 * ~/.aisa/key and read the key only from here, so dropping the write would
 * silently log out anyone still running one alongside a newer copy.
 */
const CONFIG_FILE_MODE = 0o600;

const config = new Conf({
  projectName: "aisa-cli",
  configFileMode: CONFIG_FILE_MODE,
  schema: {
    tokens: { type: "object", default: {} },
    apiKey: { type: "string", default: "" },
    defaultModel: { type: "string", default: "gpt-4.1-mini" },
    baseUrl: { type: "string", default: "https://api.aisa.one/v1" },
    routerUrl: { type: "string", default: "" },
    outputFormat: { type: "string", default: "text" },
    // Set by --lang or the page's picker; read by both renderers so they
    // never end up in different languages.
    lang: { type: "string", default: "" },
    twitterCookies: { type: "string", default: "" },
    twitterProxy: { type: "string", default: "" },
  },
});

// configFileMode only applies when conf writes. Every install that ran before
// this change already has the file on disk at 0644, and a user who never logs
// in again would keep it — so tighten what is already there, once, at startup.
// Best-effort: a config we cannot chmod is still a config we can read.
try {
  chmodSync(config.path, CONFIG_FILE_MODE);
} catch {
  /* not ours to chmod, or gone — neither is worth failing a command over */
}

/** Next step when no local credential is present. */
export { AUTH_SETUP_GUIDANCE, MISSING_API_KEY_GUIDANCE } from "./constants.js";

export async function getAccessToken(): Promise<string | undefined> {
  if (process.env[ENV_VAR_NAME]) return process.env[ENV_VAR_NAME];
  return withTokenLock(async () => {
    const tokens = readTokens();
    if (!tokens) return undefined;
    if (canRefresh(tokens) && typeof tokens.expiresAt === "number" && tokens.expiresAt <= Date.now() + 60_000) {
      return (await refreshLocked(tokens)) ?? tokens.accessToken;
    }
    return tokens.accessToken;
  });
}

export async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    console.error(MISSING_API_KEY_GUIDANCE);
    process.exit(1);
  }
  return token;
}

function makeTokens(accessToken: string, refreshToken?: string, expiresAt?: number, clientId?: string): StoredTokens {
  return accessToken.startsWith("sk-") ? { accessToken } : { accessToken, refreshToken, expiresAt, clientId };
}

/** Low-level storage; interactive login must use replaceTokens to retire the previous grant. */
export async function storeTokens(accessToken: string, refreshToken?: string, expiresAt?: number, clientId?: string): Promise<void> {
  await withTokenLock(() => writeTokens(makeTokens(accessToken, refreshToken, expiresAt, clientId)));
}

function writeTokens(tokens: StoredTokens, previousAccessToken?: string): void {
  assertTokenLock();
  // The rotated credential is authoritative. Auxiliary metadata must never
  // prevent its persistence or turn a successful refresh into an old-token fallback.
  writeJson(tokenFile(), tokens);
  try {
    if (previousAccessToken) {
      writeJson(rotationFile(), { previous: tokenHash(previousAccessToken), current: tokenHash(tokens.accessToken) });
    } else removeFile(rotationFile());
  } catch { /* rotation hints are optional; their hashes are checked before reuse */ }
  try {
    config.set("tokens", tokens);
    config.set("apiKey", tokens.accessToken);
    writeFileSync(keyFile(), tokens.accessToken + "\n", { mode: 0o600 });
    chmodSync(keyFile(), 0o600);
  } catch {
    console.error("Credentials saved, but legacy credential mirrors could not be updated.");
  }
}

function canRefresh(tokens: StoredTokens): boolean {
  return !tokens.accessToken.startsWith("sk-") &&
    typeof tokens.refreshToken === "string" && !!tokens.refreshToken &&
    typeof tokens.clientId === "string" && !!tokens.clientId;
}

/** All reads, rotation and persistence are serialized across CLI processes. */
export async function refreshAccessToken(accessToken?: string): Promise<string | undefined> {
  if (process.env[ENV_VAR_NAME]) return undefined;
  return withTokenLock(async () => {
    const tokens = readTokens();
    if (!tokens || !canRefresh(tokens)) return undefined;
    if (accessToken && accessToken !== tokens.accessToken) {
      try {
        const rotation = JSON.parse(readFileSync(rotationFile(), "utf-8"));
        return rotation.previous === tokenHash(accessToken) && rotation.current === tokenHash(tokens.accessToken)
          ? tokens.accessToken : undefined;
      } catch { return undefined; }
    }
    return refreshLocked(tokens);
  });
}

async function refreshLocked(tokens: StoredTokens): Promise<string | undefined> {
  let next: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    const response = await httpFetch(`${AUTH_SERVER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken!, client_id: tokens.clientId! }),
      timeoutMs: 20_000, idempotent: false, redirect: "error",
    });
    if (!response.ok) return undefined;
    next = await response.json();
    if (typeof next.access_token !== "string" || !next.access_token) return undefined;
  } catch { return undefined; }
  try {
    writeTokens(makeTokens(next.access_token,
      typeof next.refresh_token === "string" && next.refresh_token ? next.refresh_token : tokens.refreshToken,
      tokenExpiresAt(next.expires_in), tokens.clientId), tokens.accessToken);
  } catch {
    throw new Error("Clerk refreshed the session, but the new credentials could not be saved. Restore credential-directory write access and sign in again.");
  }
  return next.access_token;
}

export function tokenExpiresAt(expiresIn?: number): number | undefined {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn >= 0
    ? Date.now() + expiresIn * 1000 : undefined;
}

async function revokeTokens(tokens?: StoredTokens): Promise<boolean> {
  if (!tokens?.refreshToken || tokens.accessToken.startsWith("sk-")) return false;
  if (!tokens.clientId) throw new Error("Stored OAuth client ID is missing. Credentials retained; server revocation could not be completed.");
  let response: Response;
  try {
    response = await httpFetch(`${AUTH_SERVER}/oauth/token/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: "refresh_token", client_id: tokens.clientId }),
      timeoutMs: 20_000, idempotent: false, redirect: "error",
    });
  } catch { throw new Error("Could not reach Clerk to revoke the OAuth session. Credentials retained; retry the command."); }
  if (!response.ok) throw new Error(`OAuth revocation failed (HTTP ${response.status}). Credentials retained; retry the command.`);
  return true;
}

// A replacement is journaled before revoking the old grant. Failed cleanup
// never discards the only copy of a newly issued, non-expiring refresh token.
function readPending(): StoredTokens[] {
  let pending: StoredTokens[];
  try { pending = JSON.parse(readFileSync(pendingFile(), "utf-8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    pending = [];
  }
  // Import lock-acquisition failures atomically into the ordinary cleanup queue.
  for (const name of readdirSync(aisaDir())) {
    if (!/^\.pending-login-[0-9a-f-]+\.json$/.test(name)) continue;
    const path = join(aisaDir(), name);
    const recovered: StoredTokens = JSON.parse(readFileSync(path, "utf-8"));
    if (!pending.some((entry) => sameGrant(entry, recovered))) pending.push(recovered);
    writeJson(pendingFile(), pending);
    removeFile(path);
  }
  return pending;
}

function sameGrant(a: StoredTokens | undefined, b: StoredTokens): boolean {
  return !!a && a.clientId === b.clientId && a.refreshToken === b.refreshToken &&
    (b.refreshToken ? true : a.accessToken === b.accessToken);
}

async function cleanupPending(keep?: StoredTokens): Promise<void> {
  const current = readTokenFile();
  const pending = readPending();
  for (let i = pending.length - 1; i >= 0; i--) {
    if (keep && sameGrant(keep, pending[i])) continue;
    if (!sameGrant(current, pending[i])) await revokeTokens(pending[i]);
    pending.splice(i, 1);
    writeJson(pendingFile(), pending);
  }
  if (!pending.length) removeFile(pendingFile());
}

/** Replace a login only after revoking the previous OAuth grant. */
export async function replaceTokens(accessToken: string, refreshToken?: string, expiresAt?: number, clientId?: string): Promise<void> {
  const next = makeTokens(accessToken, refreshToken, expiresAt, clientId);
  let journaled = false;
  try {
    await withTokenLock(async () => {
      const pending = readPending();
      if (!pending.some((entry) => sameGrant(entry, next))) pending.push(next);
      writeJson(pendingFile(), pending);
      journaled = true;
      await cleanupPending(next);
      const previous = readTokens();
      if (previous?.refreshToken && previous.refreshToken === next.refreshToken && previous.clientId === next.clientId) {
        writeTokens(next);
        removeFile(pendingFile());
        return;
      }
      await revokeTokens(previous);
      writeTokens(next);
      removeFile(pendingFile());
    });
  } catch (error) {
    if (!journaled && next.refreshToken) {
      // Clerk already issued this grant before we attempted to acquire the lock.
      // Preserve it independently so later login/logout can revoke it.
      try {
        writeIndependentJson(join(aisaDir(), `.pending-login-${randomUUID()}.json`), next);
      } catch {
        try { await revokeTokens(next); }
        catch { throw new Error("Login failed; the newly issued OAuth grant could neither be saved for cleanup nor revoked. Check Clerk authorization management."); }
      }
    }
    throw error;
  }
}

export async function revokeAndClearTokens(): Promise<boolean> {
  return withTokenLock(async () => {
    await cleanupPending();
    const revoked = await revokeTokens(readTokens());
    clearTokensLocked();
    return revoked;
  });
}

export async function clearTokens(): Promise<void> {
  await withTokenLock(async () => {
    await cleanupPending();
    clearTokensLocked();
  });
}

function clearTokensLocked(): void {
  for (const path of [tokenFile(), keyFile(), rotationFile()]) removeFile(path);
  config.delete("tokens");
  config.delete("apiKey");
}

export function getKeySource(): "env" | "config" | "none" {
  if (process.env[ENV_VAR_NAME]) return "env";
  return readTokenFile() || readLegacyKey() ? "config" : "none";
}

export function getConfig(key: string): unknown {
  return config.get(key);
}

export function setConfig(key: string, value: string): void {
  config.set(key, value);
}

export function listConfig(): Record<string, unknown> {
  return config.store;
}

export function resetConfig(): void {
  config.clear();
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}
