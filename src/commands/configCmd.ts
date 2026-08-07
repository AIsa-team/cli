import chalk from "chalk";
import { getConfig, setConfig, listConfig, resetConfig } from "../config.js";
import { success, info, hint } from "../utils/display.js";
import { resolveBases } from "../api.js";

const VALID_KEYS = ["defaultModel", "baseUrl", "outputFormat", "twitterCookies", "twitterProxy"];

export function configSetAction(key: string, value: string): void {
  if (!VALID_KEYS.includes(key)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${VALID_KEYS.join(", ")}`);
    process.exit(1);
  }

  if (key === "baseUrl" && !/^https?:\/\/[^/]+/.test(value.trim())) {
    console.error(`baseUrl must be an absolute http(s) URL, got: ${value}`);
    process.exit(1);
  }

  setConfig(key, value);
  success(`${key} = ${value}`);

  if (key === "baseUrl") {
    const bases = resolveBases();
    hint(`LLM:         ${bases.llm}`);
    hint(`Integration: ${bases.domain}`);
    hint(`Catalog:     ${bases.info}`);
  }
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

  // baseUrl configures a root that three different bases are derived from;
  // showing them makes a self-hosted setup verifiable.
  const bases = resolveBases();
  console.log(`\n  ${chalk.gray("Derived from baseUrl:")}`);
  console.log(`  ${chalk.gray(`LLM         ${bases.llm}`)}`);
  console.log(`  ${chalk.gray(`Integration ${bases.domain}`)}`);
  console.log(`  ${chalk.gray(`Catalog     ${bases.info}`)}`);
}

export function configResetAction(): void {
  resetConfig();
  success("Config reset to defaults.");
}
