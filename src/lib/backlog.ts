// Unanswered-backlog ordering for the review queue. Pure so it is unit-tested.
//
// The core problem is comments going unanswered, so the queue leads with the
// comments most worth a reply: real client opportunities first (SPEC 8a),
// then questions, then the rest of the `respond` pile, then the moderation
// and political items. Within a tier the newest comment comes first, because a
// viewer who asked yesterday is more likely to see the answer than one who
// asked 80 days ago.

import { OPPORTUNITY_NOTIFY_THRESHOLD, type Category, type OpportunityType } from "./domain";

const QUESTION_START =
  /^(how|what|why|when|where|who|which|should|can|could|would|will|is|are|am|do|does|did|was|were|has|have|any|anyone|thoughts|curious|wondering)\b/i;
const QUESTION_PHRASE =
  /\b(any advice|what do you think|your take|would love your take|do you recommend|how do i|how do we|should i|should we|can i|can we|is it worth|is there a catch|wondering if|curious if|help me understand)\b/i;

/** Heuristic fallback when the categorizer did not say whether it is a question. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  if (QUESTION_PHRASE.test(t)) return true;
  return t
    .split(/(?<=[.!])\s+|\n+/)
    .some((sentence) => QUESTION_START.test(sentence.trim()));
}

export type BacklogItem = {
  category: Category;
  text: string;
  publishedAt: string; // ISO
  isQuestion?: boolean | null;
  opportunityType?: OpportunityType | null;
  opportunityScore?: number | null;
  likeCount?: number;
};

export function isQuestionItem(item: Pick<BacklogItem, "isQuestion" | "text">): boolean {
  return item.isQuestion ?? looksLikeQuestion(item.text);
}

export function isOpportunityItem(item: Pick<BacklogItem, "opportunityType" | "opportunityScore">): boolean {
  return (
    !!item.opportunityType &&
    item.opportunityType !== "none" &&
    (item.opportunityScore ?? 0) >= OPPORTUNITY_NOTIFY_THRESHOLD
  );
}

/**
 * Lower tier sorts first.
 *   0 opportunity (any category except political/spam/troll, which the
 *     categorizer always scores none anyway)
 *   1 respond + question
 *   2 respond
 *   3 flag_political (needs a human answer or dismissal)
 *   4 delete_troll, 5 delete_spam (moderation)
 *   6 ignore
 */
export function backlogTier(item: BacklogItem): number {
  if (isOpportunityItem(item) && item.category !== "delete_spam" && item.category !== "delete_troll") return 0;
  switch (item.category) {
    case "respond":
      return isQuestionItem(item) ? 1 : 2;
    case "flag_political":
      return 3;
    case "delete_troll":
      return 4;
    case "delete_spam":
      return 5;
    default:
      return 6;
  }
}

export function compareBacklog(a: BacklogItem, b: BacklogItem): number {
  const ta = backlogTier(a);
  const tb = backlogTier(b);
  if (ta !== tb) return ta - tb;
  if (ta === 0) {
    const s = (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0);
    if (s !== 0) return s;
  }
  const t = Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  if (t !== 0) return t;
  return (b.likeCount ?? 0) - (a.likeCount ?? 0);
}

export function sortBacklog<T extends BacklogItem>(items: T[]): T[] {
  return [...items].sort(compareBacklog);
}

export type UnansweredCounts = {
  needsReply: number; // pending respond (plus opportunities in any reply-able category)
  questions: number; // of those, questions
  opportunities: number;
};

/** Counts for one channel's pending items. Pass only pending, unanswered items. */
export function unansweredCounts(items: BacklogItem[]): UnansweredCounts {
  let needsReply = 0;
  let questions = 0;
  let opportunities = 0;
  for (const i of items) {
    if (i.category !== "respond") continue;
    needsReply++;
    if (isQuestionItem(i)) questions++;
    if (isOpportunityItem(i)) opportunities++;
  }
  return { needsReply, questions, opportunities };
}
