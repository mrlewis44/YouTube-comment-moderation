import { test } from "node:test";
import assert from "node:assert/strict";
import { backlogTier, looksLikeQuestion, sortBacklog, unansweredCounts, type BacklogItem } from "./backlog";

test("question heuristic", () => {
  assert.equal(looksLikeQuestion("Is there a catch?"), true);
  assert.equal(looksLikeQuestion("How do points work on a 30 year loan"), true);
  assert.equal(looksLikeQuestion("Great video. Should I wait for rates to drop"), true);
  assert.equal(looksLikeQuestion("Would love your take on the depreciation angle."), true);
  assert.equal(looksLikeQuestion("Good information."), false);
  assert.equal(looksLikeQuestion("This take is lazy and you know it."), false);
  assert.equal(looksLikeQuestion(""), false);
});

const base = (o: Partial<BacklogItem> & { id: string }): BacklogItem & { id: string } => ({
  category: "respond",
  text: "A statement.",
  publishedAt: "2026-10-01T00:00:00Z",
  ...o,
});

test("sort: opportunities by score, then questions, then other respond, newest first within a tier", () => {
  const items = [
    base({ id: "statement-new", publishedAt: "2026-10-10T00:00:00Z" }),
    base({ id: "question-old", text: "Why?", publishedAt: "2026-08-01T00:00:00Z" }),
    base({ id: "question-new", isQuestion: true, publishedAt: "2026-10-05T00:00:00Z" }),
    base({ id: "lead-low", opportunityType: "loan", opportunityScore: 0.65 }),
    base({ id: "lead-high", opportunityType: "real_estate", opportunityScore: 0.9, publishedAt: "2026-07-25T00:00:00Z" }),
    base({ id: "below-threshold", opportunityType: "loan", opportunityScore: 0.4, text: "ok." }),
    base({ id: "political", category: "flag_political", text: "Who is to blame?" }),
    base({ id: "spam", category: "delete_spam" }),
    base({ id: "troll", category: "delete_troll" }),
    base({ id: "ignore", category: "ignore" }),
  ];
  assert.deepEqual(
    sortBacklog(items).map((i) => i.id),
    ["lead-high", "lead-low", "question-new", "question-old", "statement-new", "below-threshold", "political", "troll", "spam", "ignore"],
  );
});

test("model isQuestion=false overrides the heuristic", () => {
  assert.equal(backlogTier(base({ id: "x", text: "Really?", isQuestion: false })), 2);
});

test("spam and troll never sort as opportunities", () => {
  assert.equal(backlogTier(base({ id: "s", category: "delete_spam", opportunityType: "loan", opportunityScore: 0.99 })), 5);
});

test("unanswered counts per channel", () => {
  const counts = unansweredCounts([
    base({ id: "1", text: "How much down?" }),
    base({ id: "2", isQuestion: true, opportunityType: "loan", opportunityScore: 0.8 }),
    base({ id: "3" }),
    base({ id: "4", category: "flag_political", text: "Why?" }),
    base({ id: "5", category: "ignore", text: "?" }),
  ]);
  assert.deepEqual(counts, { needsReply: 3, questions: 2, opportunities: 1 });
});
