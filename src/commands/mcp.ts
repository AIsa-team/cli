import { existsSync, readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import { success, error, info, hint } from "../utils/display.js";
import { expandHome, ensureDir } from "../utils/file.js";
import { MCP_CONFIGS, MCP_URL } from "../constants.js";
import { join } from "node:path";

export function mcpSetupAction(options: { agent?: string }): void {
  const targets = options.agent && options.agent !== "all"
    ? [options.agent]
    : Object.keys(MCP_CONFIGS);

  let configured = 0;

  for (const agent of targets) {
    const config = MCP_CONFIGS[agent];
    if (!config) {
      error(`Unknown agent: ${agent}. Valid: ${Object.keys(MCP_CONFIGS).join(", ")}, all`);
      return;
    }

    const filePath = expandHome(config.path);

    let existing: Record<string, unknown> = {};
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch {
        existing = {};
      }
    } else {
      ensureDir(join(filePath, ".."));
    }

    const servers = (existing[config.key] as Record<string, unknown>) || {};
    servers["aisa"] = { url: MCP_URL };
    existing[config.key] = servers;

    writeFileSync(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    console.log(`  ${chalk.green("✓")} ${agent}: ${config.path}`);
    configured++;
  }

  if (configured > 0) {
    success(`MCP server configured for ${configured} agent(s)`);
    hint("Restart your agent/editor to activate");
  }
}

export function mcpStatusAction(): void {
  info(`MCP Server: ${MCP_URL}`);

  for (const [agent, config] of Object.entries(MCP_CONFIGS)) {
    const filePath = expandHome(config.path);
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        const servers = data[config.key] as Record<string, unknown> | undefined;
        if (servers?.["aisa"]) {
          console.log(`  ${chalk.green("✓")} ${agent}: configured`);
        } else {
          console.log(`  ${chalk.gray("○")} ${agent}: not configured`);
        }
      } catch {
        console.log(`  ${chalk.gray("○")} ${agent}: config unreadable`);
      }
    } else {
      console.log(`  ${chalk.gray("○")} ${agent}: not installed`);
    }
  }

  hint("Run 'aisa mcp setup' to configure");
}
