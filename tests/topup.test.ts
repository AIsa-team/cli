import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `topup` decides one thing — which URL the user lands on — and refuses bad
 * amounts before opening anything. Both matter: a wrong URL sends someone to
 * a page that cannot take their money, and a silently-accepted "20usd" would
 * deep-link an amount the billing page cannot read.
 */

const opened: string[] = [];
vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[]) => {
    opened.push(args[0]);
  },
}));

const { topupAction } = await import("../src/commands/account.js");
const { CONSOLE_BILLING_URL } = await import("../src/constants.js");

describe("topup", () => {
  let logged: string[];

  beforeEach(() => {
    opened.length = 0;
    logged = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.join(" "));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("opens the billing page with no amount, letting the page ask", () => {
    topupAction(undefined);
    expect(opened).toEqual([CONSOLE_BILLING_URL]);
  });

  it("deep-links the amount when one is given", () => {
    topupAction("20");
    expect(opened).toEqual([`${CONSOLE_BILLING_URL}?amount=20`]);
  });

  it("keeps a decimal amount intact", () => {
    topupAction("12.5");
    expect(opened).toEqual([`${CONSOLE_BILLING_URL}?amount=12.5`]);
  });

  it.each(["0", "-5", "abc", "20usd", ""])("refuses %o without opening anything", (amount) => {
    topupAction(amount);
    expect(opened).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("prints the URL instead of opening it with --no-open", () => {
    topupAction("20", { open: false });
    expect(opened).toEqual([]);
    expect(logged.join("\n")).toContain(`${CONSOLE_BILLING_URL}?amount=20`);
  });
});
