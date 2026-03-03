import chalk from "chalk";
import { getConfig, setConfig, listConfig, resetConfig } from "../config.js";
import { success, info } from "../utils/display.js";

const VALID_KEYS = ["defaultModel", "baseUrl", "outputFormat"];

export function configSetAction(key: string, value: string): void {
  if (!VALID_KEYS.includes(key)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${VALID_KEYS.join(", ")}`);
    process.exit(1);
  }
  setConfig(key, value);
  success(`${key} = ${value}`);
}

export function configGetAction(key: string): void {
  const value = getConfig(key);
  if (value === undefined) {
    info(`${key} is not set.`);
  } else {
    console.log(`  ${key} = ${value}`);
  }
}

export function configListAction(): void {
  const all = listConfig();
  const display = { ...all };
  if (display.apiKey) {
    display.apiKey = "****";
  }
  for (const [k, v] of Object.entries(display)) {
    console.log(`  ${chalk.cyan(k)} = ${v}`);
  }
}

export function configResetAction(): void {
  resetConfig();
  success("Config reset to defaults.");
}
