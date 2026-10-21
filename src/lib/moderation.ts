// Human-approved actions from the review queue, wired to YouTube and the
// action log (SPEC Sections 4, 5, 7, 8). Every public write here is a direct
// result of a signed-in reviewer clicking a button. Nothing in this module
// runs on a schedule. The only automatic writes live in ingest.ts (graduated
// spam auto-hide, blocked-author auto-hide), exactly as SPEC Section 7 allows.

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, actionLog, authors, channels, commentReviews, comments } from "@/db";
import { stripEmDashes } from "./anthropic";
import { findAuthor, recordOffense, setAuthorBlocked } from "./authors";
import { clientForChannel, noteTokenHealth } from "./channel-client";
import { CHANNELS, channelKeyForPlatformId, type ChannelKey } from "./domain";
import { blockEligibility } from "./moderation-rules";
import { REVERSIBLE_HIDE, type HideStatus } from "./youtube";
import { YouTubeApiError, friendlyYouTubeError } from "./youtube-errors";

export const REVIEW_ACTIONS = ["post_reply", "hide", "hide_and_block", "dismiss", "restore"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export type Actor = { email: string; channels: ChannelKey[] };

export type ActionResult =
  | { ok: true; status: string; message: string }
  | { ok: false; httpStatus: number; error: string };

const MAX_REPLY_CHARS = 10_000;

function fail(httpStatus: number, error: string): ActionResult {
  return { ok: false, httpStatus, error };
}

async function loadReview(reviewId: number) {
  const [row] = await db
    .select({ review: commentReviews, comment: comments, channel: channels })
    .from(commentReviews)
    .innerJoin(comments, eq(commentReviews.commentId, comments.id))
    .innerJoin(channels, eq(comments.channelId, channels.id))
    .where(eq(commentReviews.id, reviewId));
  return row ?? null;
}

/**
 * Claim a review so two reviewers (or a reviewer and the cron) cannot act on
 * it at the same time. The claim expires after 2 minutes in case a request dies.
 */
async function claim(reviewId: number, by: string, expectStatus: "pending" | "deleted"): Promise<boolean> {
  const rows = await db
    .update(commentReviews)
    .set({ claimedBy: by, claimedAt: new Date() })
    .where(
      and(
        eq(commentReviews.id, reviewId),
        eq(commentReviews.status, expectStatus),
        or(isNull(commentReviews.claimedAt), lt(commentReviews.claimedAt, sql`now() - interval '2 minutes'`)),
      ),
    )
    .returning({ id: commentReviews.id });
  return rows.length > 0;
}

async function release(reviewId: number) {
  await db.update(commentReviews).set({ claimedBy: null, claimedAt: null }).where(eq(commentReviews.id, reviewId));
}

async function log(reviewId: number, actionType: string, by: string, detail?: Record<string, unknown>) {
  await db.insert(actionLog).values({ commentReviewId: reviewId, actionType, performedBy: by, detail: detail ?? null });
}

export async function performReviewAction(input: {
  reviewId: number;
  action: ReviewAction;
  text?: string;
  actor: Actor;
}): Promise<ActionResult> {
  const { reviewId, action, actor } = input;
  const row = await loadReview(reviewId);
  if (!row) return fail(404, "That comment is no longer in the queue.");
  const { review, comment, channel } = row;

  const key = channelKeyForPlatformId(channel.platformChannelId);
  if (!key || !actor.channels.includes(key)) return fail(403, "You do not have access to this channel.");
  const channelName = CHANNELS[key].displayName;

  const expect = action === "restore" ? "deleted" : "pending";
  if (review.status !== expect) {
    return fail(409, `Already handled (status: ${review.status}). Refresh the page.`);
  }

  // Validate before claiming.
  const category = review.category;
  let replyText = "";
  if (action === "post_reply") {
    if (category !== "respond" && category !== "flag_political") {
      return fail(422, "Only respond and political comments can be replied to from the queue.");
    }
    replyText = stripEmDashes((input.text ?? "").trim());
    if (!replyText) return fail(422, "The reply is empty.");
    if (replyText.length > MAX_REPLY_CHARS) return fail(422, "The reply is too long for YouTube.");
  }
  if ((action === "hide" || action === "hide_and_block") && category !== "delete_troll" && category !== "delete_spam") {
    return fail(422, "Hide is only offered for troll and spam comments.");
  }

  const authorRef = {
    channelId: channel.id,
    platformAuthorId: comment.authorChannelId,
    channelUrl: comment.authorChannelUrl,
    displayName: comment.author,
  };

  let blockReason: "single_attack" | "accumulated_pattern" | null = null;
  if (action === "hide_and_block") {
    const author = await findAuthor(authorRef);
    const elig = blockEligibility({
      category,
      confidence: review.confidenceScore ?? 0,
      priorOffenses: author?.offenseCount ?? 0,
      alreadyBlocked: author?.blocked ?? false,
    });
    if (!elig.eligible) {
      return fail(422, "This author is not block-eligible yet. Hide the comment; they surface for blocking after repeat offenses.");
    }
    blockReason = elig.reason;
  }

  if (!(await claim(reviewId, actor.email, expect))) {
    return fail(409, "Someone else is acting on this comment right now, or it was already handled. Refresh the page.");
  }

  try {
    const now = new Date();

    if (action === "dismiss") {
      const overturned = category === "delete_spam";
      await db
        .update(commentReviews)
        .set({ status: "rejected", overturned, reviewedBy: actor.email, reviewedAt: now })
        .where(eq(commentReviews.id, reviewId));
      await log(reviewId, overturned ? "dismiss_not_spam" : "dismiss", actor.email);
      return {
        ok: true,
        status: "rejected",
        message: overturned
          ? "Marked not spam. Nothing changed on YouTube. Spam autopilot's trust window restarts."
          : "Dismissed. Nothing changed on YouTube.",
      };
    }

    const client = clientForChannel(channel);

    if (action === "post_reply") {
      const threadId = comment.threadId ?? comment.parentCommentId ?? comment.platformCommentId;
      const res = await client.replyToComment(threadId, replyText);
      const edited = replyText !== (review.draftReplyText ?? "").trim();
      await db
        .update(commentReviews)
        .set({
          status: "posted",
          postedText: replyText,
          postedReplyId: res.id,
          reviewedBy: actor.email,
          reviewedAt: now,
          actionTakenAt: now,
        })
        .where(eq(commentReviews.id, reviewId));
      await log(reviewId, "post_reply", actor.email, { replyId: res.id, edited, mocked: !!res.mocked });
      await noteTokenHealth(channel.id, channelName, null);
      return { ok: true, status: "posted", message: res.mocked ? "Reply posted (mock mode, nothing sent)." : "Reply posted on YouTube." };
    }

    if (action === "hide" || action === "hide_and_block") {
      const block = action === "hide_and_block";
      const method: HideStatus = block ? "rejected" : REVERSIBLE_HIDE;
      const res = await client.setModerationStatus([comment.platformCommentId], method, { banAuthor: block });
      await db
        .update(commentReviews)
        .set({ status: "deleted", reviewedBy: actor.email, reviewedAt: now, actionTakenAt: now })
        .where(eq(commentReviews.id, reviewId));
      await recordOffense(authorRef, "hide", {
        commentId: comment.platformCommentId,
        block: block && blockReason ? { by: actor.email, reason: blockReason } : undefined,
      });
      await log(reviewId, block ? "hide_and_block" : "hide", actor.email, {
        method,
        category,
        signature: review.spamSignature,
        blockReason,
        mocked: !!res.mocked,
      });
      await noteTokenHealth(channel.id, channelName, null);
      return {
        ok: true,
        status: "deleted",
        message: block
          ? "Removed and author blocked. YouTube will reject their future comments; undo in YouTube Studio under Settings, Community, Hidden users."
          : "Hidden from public view. It sits in YouTube Studio's Held for review tab and can be restored from Activity.",
      };
    }

    if (action === "restore") {
      const hide = await lastHideMethod(reviewId);
      if (hide === "rejected") {
        return fail(
          422,
          "This comment was removed with a block, and YouTube does not allow a removed comment to be published again. Unblock the author in YouTube Studio if that was a mistake.",
        );
      }
      await client.setModerationStatus([comment.platformCommentId], "published");
      const overturned = category === "delete_spam" || review.autoActioned;
      await db
        .update(commentReviews)
        .set({ status: "restored", overturned, reviewedBy: actor.email, reviewedAt: now, actionTakenAt: now })
        .where(eq(commentReviews.id, reviewId));
      await recordOffense(authorRef, "restore");
      await log(reviewId, "restore", actor.email, { wasAuto: review.autoActioned });
      await noteTokenHealth(channel.id, channelName, null);
      return {
        ok: true,
        status: "restored",
        message: overturned
          ? "Restored to public view. Logged as an overturned decision, so spam autopilot's trust window restarts."
          : "Restored to public view.",
      };
    }

    return fail(400, "Unknown action.");
  } catch (err) {
    await noteTokenHealth(channel.id, channelName, err);
    const message = err instanceof YouTubeApiError ? friendlyYouTubeError(err, channelName) : err instanceof Error ? err.message : "Action failed";
    try {
      await log(reviewId, `${action}_failed`, actor.email, { error: message });
    } catch {
      // ignore logging failure
    }
    return fail(err instanceof YouTubeApiError && err.needsReconnect ? 424 : 502, message);
  } finally {
    await release(reviewId);
  }
}

async function lastHideMethod(reviewId: number): Promise<string | null> {
  const rows = await db
    .select({ detail: actionLog.detail, type: actionLog.actionType })
    .from(actionLog)
    .where(eq(actionLog.commentReviewId, reviewId))
    .orderBy(sql`${actionLog.performedAt} desc`);
  for (const r of rows) {
    if (r.type === "hide_and_block") return "rejected";
    const m = (r.detail as { method?: string } | null)?.method;
    if (m) return m;
  }
  // Rows hidden before 0001 used setModerationStatus=rejected.
  return rows.length ? "rejected" : null;
}

/**
 * One-click block from the repeat-offenders list. YouTube's ban rides on a
 * comment (setModerationStatus rejected + banAuthor), so we use the author's
 * most recent actioned comment. Our own flag is set either way and is what
 * hides their future comments on ingestion.
 */
export async function blockAuthor(authorId: number, actor: Actor): Promise<ActionResult> {
  const [row] = await db
    .select({ author: authors, channel: channels })
    .from(authors)
    .innerJoin(channels, eq(authors.channelId, channels.id))
    .where(eq(authors.id, authorId));
  if (!row) return fail(404, "Author not found.");
  const key = channelKeyForPlatformId(row.channel.platformChannelId);
  if (!key || !actor.channels.includes(key)) return fail(403, "You do not have access to this channel.");
  if (row.author.blocked) return fail(409, "Already blocked.");
  const channelName = CHANNELS[key].displayName;

  let youtubeNote = "";
  if (row.author.lastCommentId) {
    try {
      const client = clientForChannel(row.channel);
      await client.setModerationStatus([row.author.lastCommentId], "rejected", { banAuthor: true });
    } catch (err) {
      await noteTokenHealth(row.channel.id, channelName, err);
      youtubeNote = ` YouTube's own ban did not apply (${friendlyYouTubeError(err, channelName)}). Their future comments are still hidden on ingestion.`;
    }
  } else {
    youtubeNote = " No comment on record to apply YouTube's ban through; their future comments are still hidden on ingestion.";
  }
  await setAuthorBlocked(authorId, true, actor.email, "accumulated_pattern");
  return { ok: true, status: "blocked", message: `Blocked.${youtubeNote}` };
}

export async function unblockAuthor(authorId: number, actor: Actor): Promise<ActionResult> {
  const [row] = await db
    .select({ author: authors, channel: channels })
    .from(authors)
    .innerJoin(channels, eq(authors.channelId, channels.id))
    .where(eq(authors.id, authorId));
  if (!row) return fail(404, "Author not found.");
  const key = channelKeyForPlatformId(row.channel.platformChannelId);
  if (!key || !actor.channels.includes(key)) return fail(403, "You do not have access to this channel.");
  await setAuthorBlocked(authorId, false, actor.email, null);
  return {
    ok: true,
    status: "unblocked",
    message:
      "Unblocked in Comment Copilot. If YouTube's ban was applied, also remove them in YouTube Studio under Settings, Community, Hidden users.",
  };
}
