import { test } from "node:test";
import assert from "node:assert/strict";
import { accrueOffense, blockEligibility, shouldSurfaceForBlock, BLOCK_SURFACE_OFFENSES } from "./moderation-rules";

test("unambiguous troll is block-eligible on the first instance", () => {
  assert.deepEqual(blockEligibility({ category: "delete_troll", confidence: 0.91, priorOffenses: 0 }), {
    eligible: true,
    reason: "single_attack",
  });
});

test("ambiguous troll is hide-only on the first instance, block-eligible on the second", () => {
  assert.equal(blockEligibility({ category: "delete_troll", confidence: 0.54, priorOffenses: 0 }).eligible, false);
  assert.deepEqual(blockEligibility({ category: "delete_troll", confidence: 0.54, priorOffenses: BLOCK_SURFACE_OFFENSES - 1 }), {
    eligible: true,
    reason: "accumulated_pattern",
  });
});

test("spam is block-eligible only as a repeat pattern", () => {
  assert.equal(blockEligibility({ category: "delete_spam", confidence: 0.99, priorOffenses: 0 }).eligible, false);
  assert.equal(blockEligibility({ category: "delete_spam", confidence: 0.99, priorOffenses: 1 }).eligible, true);
});

test("never block-eligible for non-moderation categories or already-blocked authors", () => {
  for (const category of ["respond", "ignore", "flag_political", null] as const) {
    assert.equal(blockEligibility({ category, confidence: 1, priorOffenses: 10 }).eligible, false);
  }
  assert.equal(blockEligibility({ category: "delete_troll", confidence: 1, priorOffenses: 0, alreadyBlocked: true }).eligible, false);
});

test("offense accrual counts hides up and restores down, never below zero", () => {
  assert.equal(accrueOffense(0, "hide"), 1);
  assert.equal(accrueOffense(2, "hide"), 3);
  assert.equal(accrueOffense(2, "restore"), 1);
  assert.equal(accrueOffense(0, "restore"), 0);
});

test("repeat offenders surface at the threshold unless blocked", () => {
  assert.equal(shouldSurfaceForBlock({ offenseCount: 1, blocked: false }), false);
  assert.equal(shouldSurfaceForBlock({ offenseCount: 2, blocked: false }), true);
  assert.equal(shouldSurfaceForBlock({ offenseCount: 5, blocked: true }), false);
});
