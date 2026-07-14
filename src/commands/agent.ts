import chalk from "chalk";
import { table, success, hint, truncate } from "../utils/display.js";
import { fetchIndex, requireAgent, siblingAssetUrl, type FetchLike } from "../agent/index-client.js";
import type { AgentIndex } from "@aisa-one/agent-spec";

export async function agentListAction(
  _opts: Record<string, never>,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<AgentIndex> {
  const index = await fetchIndex(deps.fetchImpl);
  const rows = Object.entries(index.agents).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, e]) => [id, e.name, e.latest, truncate(e.description, 60)]);
  console.log(table(["ID", "NAME", "LATEST", "DESCRIPTION"], rows));
  hint(`install one with: aisa agent install <id>`);
  return index;
}

export async function agentInfoAction(
  id: string,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<AgentIndex["agents"][string]> {
  const index = await fetchIndex(deps.fetchImpl);
  const e = requireAgent(index, id);
  console.log(`${chalk.bold(e.name)} (${id})`);
  console.log(`  ${e.description}`);
  console.log(`  repo:   https://github.com/${e.repo}`);
  console.log(`  latest: ${e.latest}`);
  for (const [v, spec] of Object.entries(e.versions))
    console.log(`  ${v}: targets ${Object.keys(spec.targets).join(", ")}`);
  hint(`install with: aisa agent install ${id}`);
  return e;
}

export async function agentInstallAction(
  _id: string, _opts: { version?: string; runtime?: string },
): Promise<void> {
  throw new Error("not implemented");
}
export async function agentUpdateAction(
  _id: string | undefined, _opts: Record<string, never>,
): Promise<void> {
  throw new Error("not implemented");
}
export async function agentGuideAction(_id: string, _opts: { md?: boolean }): Promise<void> {
  throw new Error("not implemented");
}
