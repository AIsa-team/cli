import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectEnv } from "../src/agent/env-setup.js";
import { parseManifest } from "@aisa-one/agent-spec";

const manifest = parseManifest(`
spec: agentspec/v1
id: demo
name: Demo
version: 0.1.0
description: d
models: { default: deepseek-v4-pro, provider: aisa }
env:
  required:
    - { name: AISA_API_KEY, description: gateway }
    - { name: FOO_TOKEN, description: foo }
  optional:
    - { name: BAR_KEY, description: bar }
`);

beforeEach(() => { delete process.env.AISA_API_KEY; delete process.env.FOO_TOKEN; delete process.env.BAR_KEY; });
afterEach(() => { delete process.env.AISA_API_KEY; delete process.env.FOO_TOKEN; delete process.env.BAR_KEY; });

describe("collectEnv", () => {
  it("fills AISA_API_KEY from login credentials (env var path) and prompts the rest", async () => {
    process.env.AISA_API_KEY = "sk-from-login";
    const asked: string[] = [];
    const env = await collectEnv(manifest, null, {
      prompt: async (q) => { asked.push(q); return "foo-value"; },
    });
    expect(env).toContain("AISA_API_KEY=sk-from-login");
    expect(env).toContain("FOO_TOKEN=foo-value");
    expect(asked.join(" ")).not.toContain("AISA_API_KEY");
  });

  // .env 是用户密钥文件:系统变量不注入(系统默认来自制品 agent.json,
  // render 时经环境变量传入),旧安装种下的系统行升级时剥离
  it("emits no system vars and strips legacy ones from an existing .env", async () => {
    process.env.AISA_API_KEY = "sk-x";
    process.env.FOO_TOKEN = "f";
    const existing =
      "HERMES_HOME=~/.hermes\nPROFILE_ID=demo\nMODEL_DEFAULT=stale\nMODEL_PROVIDER=aisa\nAISA_API_KEY=sk-old\n";
    const env = await collectEnv(manifest, existing, { prompt: async () => "" });
    for (const legacy of ["HERMES_HOME", "PROFILE_ID", "MODEL_DEFAULT", "MODEL_PROVIDER"])
      expect(env).not.toMatch(new RegExp(`^${legacy}=`, "m"));
    expect(env).toContain("AISA_API_KEY=sk-old");
  });

  it("never overwrites or re-asks existing values", async () => {
    process.env.AISA_API_KEY = "sk-new";
    const existing = "AISA_API_KEY=sk-old\nFOO_TOKEN=kept\n";
    const env = await collectEnv(manifest, existing, {
      prompt: async () => { throw new Error("should not prompt"); },
    });
    expect(env).toContain("AISA_API_KEY=sk-old");
    expect(env).toContain("FOO_TOKEN=kept");
  });

  it("throws when a required var is unobtainable (non-interactive)", async () => {
    process.env.AISA_API_KEY = "sk-x";
    await expect(collectEnv(manifest, null, { prompt: async () => "" }))
      .rejects.toThrow(/FOO_TOKEN/);
  });

  it("optional vars: env value written, otherwise left as comment", async () => {
    process.env.AISA_API_KEY = "sk-x";
    process.env.FOO_TOKEN = "f";
    process.env.BAR_KEY = "b";
    const env = await collectEnv(manifest, null, { prompt: async () => "" });
    expect(env).toContain("BAR_KEY=b");
    delete process.env.BAR_KEY;
    const env3 = await collectEnv(manifest, null, { prompt: async () => "" });
    expect(env3).toMatch(/# BAR_KEY=/);
  });
});
