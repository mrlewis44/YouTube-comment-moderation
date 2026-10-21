import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSpamGraduation, shouldAutoHideSpam, type SpamDecision } from "./graduation";

const DAY = 86_400_000;
const start = new Date("2026-10-01T12:00:00Z").getTime();

function confirmed(n: number, opts: { from?: number; spacingMs?: number; sigs?: string[] } = {}): SpamDecision[] {
  const sigs = opts.sigs ?? ["trading_testimonial", "hidden_link"];
  return Array.from({ length: n }, (_, i) => ({
    decidedAt: new Date((opts.from ?? start) + i * (opts.spacingMs ?? 3600_000)),
    outcome: "confirmed" as const,
    signature: sigs[i % sigs.length],
  }));
}

test("graduates at 25 confirmed, two signatures, 7 days, no overturns", () => {
  const s = evaluateSpamGraduation(confirmed(25), new Date(start + 7 * DAY + 1));
  assert.equal(s.status, "graduated");
  assert.equal(s.reviewed, 25);
  assert.deepEqual(s.signatures, ["hidden_link", "trading_testimonial"]);
  assert.deepEqual(s.missing, []);
});

test("7-day floor holds even when 25 resolve in a burst", () => {
  const s = evaluateSpamGraduation(confirmed(40), new Date(start + 2 * DAY));
  assert.equal(s.status, "learning");
  assert.equal(s.missing.length, 1);
  assert.match(s.missing[0], /more days? of track record/);
});

test("one signature is not enough", () => {
  const s = evaluateSpamGraduation(confirmed(30, { sigs: ["trading_testimonial"] }), new Date(start + 10 * DAY));
  assert.equal(s.status, "learning");
  assert.match(s.missing.join(" "), /distinct spam signature/);
});

test("24 is not enough", () => {
  assert.equal(evaluateSpamGraduation(confirmed(24), new Date(start + 10 * DAY)).status, "learning");
});

test("an overturn restarts the window, including the 7-day floor", () => {
  const before = confirmed(30, { spacingMs: 2 * 3600_000 });
  const overturnAt = start + 3 * DAY;
  const after = confirmed(25, { from: overturnAt + 1000 });
  const decisions = [...before, { decidedAt: new Date(overturnAt), outcome: "overturned" as const, signature: "hidden_link" }, ...after];

  const soon = evaluateSpamGraduation(decisions, new Date(overturnAt + 2 * DAY));
  assert.equal(soon.status, "learning");
  assert.equal(soon.reviewed, 25);
  assert.equal(soon.lastOverturnAt?.getTime(), overturnAt);

  const later = evaluateSpamGraduation(decisions, new Date(overturnAt + 8 * DAY));
  assert.equal(later.status, "graduated");
});

test("an overturn after graduation demotes immediately", () => {
  const decisions = [...confirmed(25), { decidedAt: new Date(start + 9 * DAY), outcome: "overturned" as const, signature: null }];
  const s = evaluateSpamGraduation(decisions, new Date(start + 9 * DAY + 1000));
  assert.equal(s.status, "learning");
  assert.equal(s.reviewed, 0);
});

test("paused keeps the progress but reports paused", () => {
  const s = evaluateSpamGraduation(confirmed(25), new Date(start + 8 * DAY), { paused: true });
  assert.equal(s.graduated, true);
  assert.equal(s.paused, true);
  assert.equal(s.status, "paused");
  assert.equal(shouldAutoHideSpam({ category: "delete_spam", confidence: 0.99, spamSignature: "hidden_link" }, s), false);
});

test("auto-hide needs graduation, delete_spam, high confidence, and a known signature", () => {
  const g = { status: "graduated" as const };
  assert.equal(shouldAutoHideSpam({ category: "delete_spam", confidence: 0.95, spamSignature: "trading_testimonial" }, g), true);
  assert.equal(shouldAutoHideSpam({ category: "delete_spam", confidence: 0.7, spamSignature: "trading_testimonial" }, g), false);
  assert.equal(shouldAutoHideSpam({ category: "delete_spam", confidence: 0.99, spamSignature: "other" }, g), false);
  assert.equal(shouldAutoHideSpam({ category: "delete_troll", confidence: 0.99, spamSignature: "hidden_link" }, g), false);
  assert.equal(shouldAutoHideSpam({ category: "delete_spam", confidence: 0.99, spamSignature: "hidden_link" }, { status: "learning" }), false);
});
