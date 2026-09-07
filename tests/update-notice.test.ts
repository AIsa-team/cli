import { beforeEach, describe, expect, it } from "vitest";
import { announceUpdate, resetUpdateAnnouncement } from "../src/utils/update-check.js";

/**
 * When the "a newer aisa is out" line may appear.
 *
 * It runs at the end of every command, so the interesting cases are all the
 * ones where it must stay silent — a line appended to JSON on its way into
 * `jq` is corrupted output, and telling someone to update a copy that cannot
 * be updated is worse than saying nothing.
 */
const newer = async () => "9.9.9";

describe("update notice", () => {
  beforeEach(() => resetUpdateAnnouncement());

  it("prints on a terminal when there is something newer", async () => {
    const line = await announceUpdate({ current: "0.3.0", isTTY: true, updatable: true, lookup: newer, write: () => {} });
    expect(line).toContain("0.3.0 → 9.9.9");
    expect(line).toContain("aisa update");
  });

  it("stays out of a pipe", async () => {
    // Most commands here emit JSON; this is the case that would corrupt it.
    expect(await announceUpdate({ isTTY: false, updatable: true, lookup: newer, write: () => {} })).toBeUndefined();
  });

  it("says nothing for a copy it cannot update", async () => {
    // npx is current on every run, and a checkout is updated with git.
    expect(await announceUpdate({ isTTY: true, updatable: false, lookup: newer, write: () => {} })).toBeUndefined();
  });

  it("says nothing when there is nothing newer", async () => {
    expect(await announceUpdate({ isTTY: true, updatable: true, lookup: async () => undefined, write: () => {} })).toBeUndefined();
  });

  it("gives up rather than making a command wait on the registry", async () => {
    const slow = () => new Promise<string>((r) => setTimeout(() => r("9.9.9"), 5_000));
    const started = Date.now();
    expect(await announceUpdate({ isTTY: true, updatable: true, lookup: slow, write: () => {} })).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("speaks once per process, so connect's own line is not doubled", async () => {
    await announceUpdate({ current: "0.3.0", isTTY: true, updatable: true, lookup: newer, write: () => {} });
    expect(await announceUpdate({ current: "0.3.0", isTTY: true, updatable: true, lookup: newer, write: () => {} })).toBeUndefined();
  });
});
