import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ~/.aisa/key is the single source of truth for the credential. These tests
 * pin the three behaviours the rest of the platform depends on: the file is
 * written 0600, it wins over the legacy conf store, and a legacy-only key
 * migrates to the file on first read.
 */

let home: string;

vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  return { ...actual, homedir: () => home };
});

// conf resolves its own storage path via env-paths at import time; point it
// into the sandbox so tests never touch the real store. The stub also records
// the constructor options, so the file-mode contract can be asserted without
// reaching for the real store's platform-specific path.
let confStore: Record<string, unknown> = {};
let confOptions: Record<string, unknown> = {};
let confPath = "";
vi.mock("conf", () => ({
  default: class {
    path: string;
    constructor(options: Record<string, unknown>) {
      confOptions = options;
      this.path = confPath;
    }
    get(k: string) {
      return confStore[k] ?? "";
    }
    set(k: string, v: unknown) {
      confStore[k] = v;
    }
    delete(k: string) {
      delete confStore[k];
    }
  },
}));

const { getApiKey, setApiKey, clearApiKey } = await import("../src/config.js");

const keyPath = () => join(home, ".aisa", "key");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aisa-key-"));
  confStore = {};
  delete process.env.AISA_API_KEY;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("~/.aisa/key", () => {
  it("setApiKey writes the file with 0600 and getApiKey reads it back", () => {
    setApiKey("sk-file-key");
    expect(readFileSync(keyPath(), "utf-8").trim()).toBe("sk-file-key");
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600);
    expect(getApiKey()).toBe("sk-file-key");
  });

  it("env var wins over the file", () => {
    setApiKey("sk-file-key");
    process.env.AISA_API_KEY = "sk-env-key";
    expect(getApiKey()).toBe("sk-env-key");
    delete process.env.AISA_API_KEY;
  });

  it("the file wins over the legacy conf store", () => {
    confStore.apiKey = "sk-legacy";
    mkdirSync(join(home, ".aisa"), { recursive: true });
    writeFileSync(keyPath(), "sk-file-key\n");
    expect(getApiKey()).toBe("sk-file-key");
  });

  it("a legacy-only key migrates to the file on first read", () => {
    confStore.apiKey = "sk-legacy";
    expect(existsSync(keyPath())).toBe(false);
    expect(getApiKey()).toBe("sk-legacy");
    expect(readFileSync(keyPath(), "utf-8").trim()).toBe("sk-legacy");
  });

  it("clearApiKey removes both the file and the legacy entry", () => {
    setApiKey("sk-file-key");
    clearApiKey();
    expect(existsSync(keyPath())).toBe(false);
    expect(getApiKey()).toBeUndefined();
  });
});

/**
 * The legacy conf store mirrors the key so a published CLI up to 0.3.0 —
 * which reads only from there — keeps working beside a newer copy. That
 * mirror shipped world-readable (conf defaults to 0o666) until 2026-08-24,
 * exposing both the API key and the Twitter session cookies on shared
 * machines. Both halves of the fix are pinned here.
 */
describe("legacy conf store permissions", () => {
  it("is constructed to write 0600, not conf's 0o666 default", () => {
    expect(confOptions.configFileMode).toBe(0o600);
  });

  it("tightens a store that already exists at 0644", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aisa-conf-"));
    confPath = join(dir, "config.json");
    writeFileSync(confPath, "{}", { mode: 0o644 });
    expect(statSync(confPath).mode & 0o777).toBe(0o644);

    // The chmod runs at module load, so re-import with the path in place.
    vi.resetModules();
    await import("../src/config.js");

    expect(statSync(confPath).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
    confPath = "";
  });
});
