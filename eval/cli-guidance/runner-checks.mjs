/**
 * Offline runner scored-label and exit invariants. Standalone node:test (not *.test.mjs).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPECTED_CASE_IDS } from "./grade.mjs";
import { candidateThresholdMet, scoringPlan, suiteExitCode, suiteIdentity } from "./run.mjs";

function rows(repeats, taskPassAt = () => true) {
  const out = [];
  for (const id of EXPECTED_CASE_IDS) {
    for (let run_index = 1; run_index <= repeats; run_index += 1) {
      out.push({
        case_id: id,
        run_index,
        task_pass: taskPassAt(id, run_index),
        safety_pass: true,
      });
    }
  }
  return out;
}

describe("runner scoring plan", () => {
  it("passes all 8 frozen ids and scores only default 8x1 / 8x2", () => {
    const baseline = scoringPlan({ suite: "baseline" });
    assert.deepEqual(baseline.expectedCaseIds, EXPECTED_CASE_IDS);
    assert.equal(baseline.expectedCaseIds.length, 8);
    assert.equal(baseline.diagnostic, false);
    assert.equal(baseline.intendedScored, true);

    const candidate = scoringPlan({ suite: "candidate" });
    assert.deepEqual(candidate.expectedCaseIds, EXPECTED_CASE_IDS);
    assert.equal(candidate.diagnostic, false);
    assert.equal(candidate.intendedScored, true);
  });

  it("marks --case and custom repeats diagnostic while still passing all 8 ids", () => {
    const one = scoringPlan({ suite: "candidate", caseId: "quote-only" });
    assert.equal(one.diagnostic, true);
    assert.equal(one.intendedScored, false);
    assert.deepEqual(one.expectedCaseIds, EXPECTED_CASE_IDS);

    const custom = scoringPlan({ suite: "candidate", repeats: 3 });
    assert.equal(custom.diagnostic, true);
    assert.equal(custom.intendedScored, false);
    assert.deepEqual(custom.expectedCaseIds, EXPECTED_CASE_IDS);
  });
});

describe("runner scored label and exit", () => {
  it("marks exact 8x1 / 8x2 scored and exits 0", () => {
    const bPlan = scoringPlan({ suite: "baseline" });
    const bId = suiteIdentity(rows(1), bPlan);
    assert.equal(bId.scored, true);
    assert.equal(suiteExitCode({ plan: bPlan, identity: bId, candidateOk: false, modelMismatch: false }), 0);

    const cPlan = scoringPlan({ suite: "candidate" });
    const cRows = rows(2);
    const cId = suiteIdentity(cRows, cPlan);
    assert.equal(cId.scored, true);
    assert.equal(candidateThresholdMet(cRows, cId, cPlan), true);
    assert.equal(suiteExitCode({ plan: cPlan, identity: cId, candidateOk: true, modelMismatch: false }), 0);
  });

  it("keeps --case and custom-repeat suites unscored with exit 0", () => {
    const plan = scoringPlan({ suite: "candidate", caseId: "quote-only" });
    const identity = suiteIdentity(
      [{ case_id: "quote-only", run_index: 1, task_pass: true, safety_pass: true }],
      plan
    );
    assert.equal(identity.scored, false);
    assert.equal(suiteExitCode({ plan, identity, candidateOk: false, modelMismatch: false }), 0);

    const custom = scoringPlan({ suite: "candidate", repeats: 3 });
    const customId = suiteIdentity(rows(3), custom);
    assert.equal(customId.scored, false);
    assert.equal(suiteExitCode({ plan: custom, identity: customId, candidateOk: false, modelMismatch: false }), 0);
  });

  it("exits 1 for an incomplete intended suite", () => {
    const plan = scoringPlan({ suite: "baseline" });
    const identity = suiteIdentity(rows(1).slice(0, 7), plan);
    assert.equal(identity.ok, false);
    assert.equal(identity.scored, false);
    assert.equal(suiteExitCode({ plan, identity, candidateOk: false, modelMismatch: false }), 1);
  });

  it("exits 1 when a scored candidate misses the threshold", () => {
    const plan = scoringPlan({ suite: "candidate" });
    const fail = new Set(["quote-only:2", "missing-input:1", "uncertain-cap:2"]);
    const list = rows(2, (id, run) => !fail.has(`${id}:${run}`));
    const identity = suiteIdentity(list, plan);
    assert.equal(identity.scored, true);
    assert.equal(candidateThresholdMet(list, identity, plan), false);
    assert.equal(suiteExitCode({ plan, identity, candidateOk: false, modelMismatch: false }), 1);
  });

  it("exits 2 on resolved model mismatch", () => {
    const plan = scoringPlan({ suite: "baseline" });
    const identity = suiteIdentity(rows(1), plan);
    assert.equal(suiteExitCode({ plan, identity, candidateOk: false, modelMismatch: true }), 2);
  });
});
