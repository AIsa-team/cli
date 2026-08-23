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
// into the sandbox so tests never touch the real store.
let confStore: Record<string, unknown> = {};
vi.mock("conf", () => ({
  default: class {
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
