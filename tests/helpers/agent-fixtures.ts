import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as tar from "tar";

export async function makeArtifact(version = "1.0.0", id = "demo") {
  const src = mkdtempSync(join(tmpdir(), "aisa-art-"));
  mkdirSync(join(src, "profile"), { recursive: true });
  writeFileSync(join(src, "profile", "SOUL.template.md"), "# {{OWNER}}");
  mkdirSync(join(src, "scripts"), { recursive: true });
  writeFileSync(join(src, "scripts", "render.sh"), "#!/usr/bin/env bash\necho rendered\n");
  writeFileSync(join(src, "agent.json"), JSON.stringify({
    spec: "agentspec/v1", id, name: "Demo", version, description: "d",
    language: "en", models: { default: "deepseek-v3.2", provider: "aisa" },
    env: { required: [{ name: "AISA_API_KEY", description: "k" }], optional: [] },
    skills: { inline: [], aisa: [] }, update: { channel: "latest", auto: true },
  }));
  writeFileSync(join(src, ".env.example"), `PROFILE_ID=${id}\nAISA_API_KEY=\n`);
  const file = join(src, "..", `art-${version}-${Date.now()}.tar.gz`);
  await tar.c({ gzip: true, file, cwd: src }, ["profile", "scripts", "agent.json", ".env.example"]);
  const buf = readFileSync(file) as Buffer;
  return { buf, sha: createHash("sha256").update(buf).digest("hex") };
}

export function indexFor(id: string, latest: string, sha: string) {
  return {
    spec: "agent-index/v1",
    agents: { [id]: {
      name: "Demo", description: "d", repo: "r/x", latest,
      versions: { [latest]: { targets: { hermes: { url: `https://x/${id}.tar.gz`, sha256: sha } } } },
    } },
  };
}
