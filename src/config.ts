import Conf from "conf";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV_VAR_NAME } from "./constants.js";

// ~/.aisa is the credential home: one visible, portable, platform-stable
// place for the key, next door to ~/.claude and ~/.codex. The conf store
// (platform-specific path, invisible to other tools) remains a legacy read
// source and a sync target so older CLI versions keep working.
const aisaDir = () => join(homedir(), ".aisa");
const keyFile = () => join(aisaDir(), "key");

function readKeyFile(): string | undefined {
  try {
    const k = readFileSync(keyFile(), "utf-8").trim();
    return k || undefined;
  } catch {
    return undefined;
  }
}

function writeKeyFile(key: string): void {
  mkdirSync(aisaDir(), { recursive: true });
  writeFileSync(keyFile(), key + "\n", { mode: 0o600 });
  chmodSync(keyFile(), 0o600);
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
    apiKey: { type: "string", default: "" },
    defaultModel: { type: "string", default: "gpt-4.1-mini" },
    baseUrl: { type: "string", default: "https://api.aisa.one/v1" },
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

export function getApiKey(): string | undefined {
  const envKey = process.env[ENV_VAR_NAME];
  if (envKey) return envKey;
  const fileKey = readKeyFile();
  if (fileKey) return fileKey;
  const stored = config.get("apiKey") as string;
  if (stored) {
    // Legacy location — migrate on first read so every other tool (wrappers,
    // scripts) finds the key at the one agreed place from now on.
    try {
      writeKeyFile(stored);
    } catch {
      /* migration is best-effort; the key itself is still returned */
    }
    return stored;
  }
  return undefined;
}

export function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    console.error(
      `No API key found. Run "aisa login --key <key>" or set ${ENV_VAR_NAME}.`
    );
    process.exit(1);
  }
  return key;
}

export function setApiKey(key: string): void {
  writeKeyFile(key);
  config.set("apiKey", key);
}

export function clearApiKey(): void {
  try {
    if (existsSync(keyFile())) unlinkSync(keyFile());
  } catch {
    /* the conf delete below still applies */
  }
  config.delete("apiKey");
}

export function getKeySource(): "env" | "config" | "none" {
  if (process.env[ENV_VAR_NAME]) return "env";
  if (readKeyFile() || config.get("apiKey")) return "config";
  return "none";
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
