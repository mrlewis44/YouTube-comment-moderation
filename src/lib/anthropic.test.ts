import { test } from "node:test";
import assert from "node:assert/strict";
import { categorizeResult, describeClaudeError, draftResult, extractJson, stripEmDashes } from "./anthropic";

test("em dashes never survive a draft", () => {
  assert.equal(stripEmDashes("Rates matter — but total cost matters more."), "Rates matter, but total cost matters more.");
  assert.equal(stripEmDashes("FHA–conventional"), "FHA, conventional");
  assert.doesNotMatch(stripEmDashes("a — b – c"), /[—–]/);
});

test("categorize output parses with the new fields and tolerates bad values", () => {
  const ok = categorizeResult.parse(extractJson('Sure: {"category":"delete_spam","confidence":0.9,"reason":"r","spamSignature":"hidden_link","isQuestion":false,"opportunityType":"none","opportunityScore":0}'));
  assert.equal(ok.spamSignature, "hidden_link");
  const odd = categorizeResult.parse({ category: "respond", confidence: 0.8, reason: "r", spamSignature: "weird", isQuestion: "yes" });
  assert.equal(odd.spamSignature, null);
  assert.equal(odd.isQuestion, null);
  assert.equal(odd.opportunityType, "none");
});

test("draft output carries the political safety flag", () => {
  assert.equal(draftResult.parse({ draft: "", voice: "house", political: true }).political, true);
  assert.equal(draftResult.parse({ draft: "x", voice: "josh" }).political, false);
});

test("Claude errors: bad key and bad model stop the run, one-off errors do not", () => {
  assert.equal(describeClaudeError(Object.assign(new Error("unauthorized"), { status: 401 })).fatal, true);
  const model = describeClaudeError(Object.assign(new Error("model: not_found"), { status: 404 }));
  assert.equal(model.fatal, true);
  assert.match(model.message, /ANTHROPIC_MODEL/);
  assert.equal(describeClaudeError(new Error("No JSON in model response")).fatal, false);
});
