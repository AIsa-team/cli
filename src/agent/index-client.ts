import { parseIndex, type AgentIndex } from "@aisa-one/agent-spec";

export const DEFAULT_INDEX_URL =
  "https://raw.githubusercontent.com/AIsa-team/agent-index/main/index.json";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function indexUrl(): string {
  return process.env.AISA_AGENT_INDEX_URL || DEFAULT_INDEX_URL;
}

export async function fetchIndex(fetchImpl: FetchLike = fetch): Promise<AgentIndex> {
  const res = await fetchImpl(indexUrl());
  if (!res.ok) throw new Error(`failed to fetch agent index (${res.status}): ${indexUrl()}`);
  return parseIndex(await res.text());
}

export function requireAgent(index: AgentIndex, id: string): AgentIndex["agents"][string] {
  const entry = index.agents[id];
  if (!entry) {
    const available = Object.keys(index.agents).sort().join(", ") || "(none)";
    throw new Error(`unknown agent "${id}"\navailable agents: ${available}`);
  }
  return entry;
}

export function siblingAssetUrl(artifactUrl: string, filename: string): string {
  return artifactUrl.replace(/[^/]+$/, filename);
}
