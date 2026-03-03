import Conf from "conf";
import { ENV_VAR_NAME } from "./constants.js";

const config = new Conf({
  projectName: "aisa-cli",
  schema: {
    apiKey: { type: "string", default: "" },
    defaultModel: { type: "string", default: "gpt-4.1" },
    baseUrl: { type: "string", default: "https://api.aisa.one" },
    outputFormat: { type: "string", default: "text" },
  },
});

export function getApiKey(): string | undefined {
  const envKey = process.env[ENV_VAR_NAME];
  if (envKey) return envKey;
  const stored = config.get("apiKey") as string;
  return stored || undefined;
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
  config.set("apiKey", key);
}

export function clearApiKey(): void {
  config.delete("apiKey");
}

export function getKeySource(): "env" | "config" | "none" {
  if (process.env[ENV_VAR_NAME]) return "env";
  if (config.get("apiKey")) return "config";
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
