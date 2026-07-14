import type { AgentManifest } from "@aisa-one/agent-spec";
import { getApiKey } from "../config.js";

export type Prompt = (question: string) => Promise<string>;

function parseEnvText(text: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of (text ?? "").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && m[2] !== "") map.set(m[1], m[2]);
  }
  return map;
}

export async function collectEnv(
  manifest: AgentManifest,
  existingEnvText: string | null,
  deps: { prompt?: Prompt } = {},
): Promise<string> {
  const prompt = deps.prompt ?? (async () => "");
  const existing = parseEnvText(existingEnvText);
  const values = new Map<string, string>(existing);

  values.set("PROFILE_ID", manifest.id);
  if (!values.has("MODEL_DEFAULT")) values.set("MODEL_DEFAULT", manifest.models.default);
  if (!values.has("MODEL_PROVIDER")) values.set("MODEL_PROVIDER", manifest.models.provider);

  for (const v of manifest.env.required) {
    if (values.has(v.name)) continue;
    let val = process.env[v.name] || "";
    if (!val && v.name === "AISA_API_KEY") val = getApiKey() ?? "";
    if (!val) val = await prompt(`${v.name} (${v.description}): `);
    if (!val) throw new Error(
      `missing required ${v.name} — set it in your environment` +
      (v.name === "AISA_API_KEY" ? ` or run "aisa login --key <key>"` : ""));
    values.set(v.name, val);
  }

  const lines: string[] = [
    `# ${manifest.name} — profile environment (managed by aisa agent install)`,
  ];
  for (const [k, v] of values) lines.push(`${k}=${v}`);
  for (const v of manifest.env.optional) {
    if (values.has(v.name)) continue;
    if (process.env[v.name]) lines.push(`${v.name}=${process.env[v.name]}`);
    else lines.push(`# ${v.name}=  (${v.description}${v.degrade ? `; degrade: ${v.degrade}` : ""})`);
  }
  return lines.join("\n") + "\n";
}
