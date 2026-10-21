// Loads human spam decisions from the DB and evaluates delete_spam graduation
// (SPEC Section 7). Graduation is evaluated across both channels: the spam
// signatures are the same bots on either channel, and pooling reaches the
// 25-decision bar sooner without lowering it.

import { and, eq, isNotNull, or } from "drizzle-orm";
import { db, commentReviews } from "@/db";
import { evaluateSpamGraduation, type GraduationState, type SpamDecision } from "./graduation";
import { isSpamAutopilotPaused } from "./settings";

export async function loadSpamDecisions(): Promise<SpamDecision[]> {
  const rows = await db
    .select({
      reviewedAt: commentReviews.reviewedAt,
      status: commentReviews.status,
      overturned: commentReviews.overturned,
      autoActioned: commentReviews.autoActioned,
      signature: commentReviews.spamSignature,
    })
    .from(commentReviews)
    .where(
      and(
        eq(commentReviews.category, "delete_spam"),
        isNotNull(commentReviews.reviewedAt),
        // Human decisions, plus any overturn (a restore of an auto-hide is a
        // human overturning the system).
        or(eq(commentReviews.autoActioned, false), eq(commentReviews.overturned, true)),
      ),
    );

  const out: SpamDecision[] = [];
  for (const r of rows) {
    if (!r.reviewedAt) continue;
    if (r.overturned) {
      out.push({ decidedAt: r.reviewedAt, outcome: "overturned", signature: r.signature });
    } else if (r.status === "deleted") {
      out.push({ decidedAt: r.reviewedAt, outcome: "confirmed", signature: r.signature });
    }
  }
  return out;
}

export async function loadGraduationState(now = new Date()): Promise<GraduationState> {
  const [decisions, paused] = await Promise.all([loadSpamDecisions(), isSpamAutopilotPaused()]);
  return evaluateSpamGraduation(decisions, now, { paused });
}
