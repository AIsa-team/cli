import { describe, expect, it } from "vitest";
import { browserCommand } from "../src/utils/browser.js";

/**
 * On Windows, `start` is built into cmd.exe and cannot be run on its own:
 * calling it directly failed with ENOENT, so the browser never opened and
 * `aisa login` timed out. These pin the command each platform gets.
 */

const AUTH_URL =
  "https://clerk.aisa.one/oauth/authorize?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback&state=xyz";

describe("browserCommand", () => {
  it("uses open on macOS", () => {
    expect(browserCommand(AUTH_URL, "darwin")).toEqual({ file: "open", args: [AUTH_URL] });
  });

  it("uses xdg-open on Linux", () => {
    expect(browserCommand(AUTH_URL, "linux")).toEqual({ file: "xdg-open", args: [AUTH_URL] });
  });

  it("goes through cmd.exe on Windows, never runs start directly", () => {
    const { file, args } = browserCommand(AUTH_URL, "win32");
    expect(file).toBe("cmd");
    expect(args.slice(0, 3)).toEqual(["/c", "start", ""]);
  });

  it("escapes & on Windows so cmd.exe keeps the whole URL", () => {
    const { args } = browserCommand(AUTH_URL, "win32");
    const passed = args[3];
    expect(passed).not.toMatch(/(^|[^^])&/);
    // Undoing cmd.exe's escaping gives back the exact URL.
    expect(passed.replace(/\^(.)/g, "$1")).toBe(AUTH_URL);
  });

  it("escapes every cmd.exe special character on Windows", () => {
    const url = "https://example.com/a?x=(1)&y=a|b&z=<c>^d";
    const { args } = browserCommand(url, "win32");
    expect(args[3]).toBe("https://example.com/a?x=^(1^)^&y=a^|b^&z=^<c^>^^d");
  });

  it("leaves a URL without special characters unchanged on Windows", () => {
    const url = "https://console.aisa.one/billing";
    expect(browserCommand(url, "win32").args[3]).toBe(url);
  });
});
