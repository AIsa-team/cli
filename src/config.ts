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

const config = new Conf({
  projectName: "aisa-cli",
  schema: {
    apiKey: { type: "string", default: "" },
    defaultModel: { type: "string", default: "gpt-4.1-mini" },
    baseUrl: { type: "string", default: "https://api.aisa.one/v1" },
    outputFormat: { type: "string", default: "text" },
    twitterCookies: { type: "string", default: "" },
    twitterProxy: { type: "string", default: "" },
  },
});

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
