// Loads the live review queue from the database: pending, triaged comments
// joined with their categorization, draft, and author record, sorted so the
// unanswered backlog leads (backlog.ts). Never throws: on any failure (DB not
// provisioned, tables missing) it reports dbOk=false so the page can fall back
// to the sample comments.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { CHANNELS, channelKeyForPlatformId, type ChannelKey } from "./domain";
import { sortBacklog, unansweredCounts, type UnansweredCounts } from "./backlog";
import type { QueueItem } from "./mock";

export type QueueData = {
  dbOk: boolean;
  items: QueueItem[];
  counts: Partial<Record<ChannelKey, UnansweredCounts>>;
  truncated: boolean;
};

const LIMIT = 1000;

export async function loadQueue(accessible: ChannelKey[]): Promise<QueueData> {
  const empty: QueueData = { dbOk: false, items: [], counts: {}, truncated: false };
  if (accessible.length === 0) return { ...empty, dbOk: true };
  const platformIds = accessible.map((k) => CHANNELS[k].platformChannelId);

  try {
    const { db, comments, commentReviews, channels, authors } = await import("@/db");
    const rows = await db
      .select({
        reviewId: commentReviews.id,
        category: commentReviews.category,
        confidence: commentReviews.confidenceScore,
        draft: commentReviews.draftReplyText,
        draftVoice: commentReviews.draftVoice,
        oppType: commentReviews.opportunityType,
        oppScore: commentReviews.opportunityScore,
        isQuestion: commentReviews.isQuestion,
        spamSignature: commentReviews.spamSignature,
        triageError: commentReviews.triageError,
        text: comments.text,
        author: comments.author,
        videoId: comments.videoId,
        videoTitle: comments.videoTitle,
        platformCommentId: comments.platformCommentId,
        threadId: comments.threadId,
        parentCommentId: comments.parentCommentId,
        likeCount: comments.likeCount,
        publishedAt: comments.publishedAt,
        platformChannelId: channels.platformChannelId,
        offenseCount: authors.offenseCount,
        blocked: authors.blocked,
      })
      .from(commentReviews)
      .innerJoin(comments, eq(commentReviews.commentId, comments.id))
      .innerJoin(channels, eq(comments.channelId, channels.id))
      .leftJoin(
        authors,
        and(eq(authors.channelId, comments.channelId), eq(authors.platformAuthorId, comments.authorChannelId)),
      )
      .where(
        and(
          eq(commentReviews.status, "pending"),
          isNotNull(commentReviews.category),
          inArray(channels.platformChannelId, platformIds),
        ),
      )
      .orderBy(sql`${comments.publishedAt} desc nulls last`)
      .limit(LIMIT);

    const items: QueueItem[] = rows.map((r) => ({
      id: `r${r.reviewId}`,
      reviewId: r.reviewId,
      videoId: r.videoId,
      platformCommentId: r.platformCommentId,
      channel: channelKeyForPlatformId(r.platformChannelId) ?? accessible[0],
      videoTitle: r.videoTitle ?? "",
      author: r.author ?? "",
      text: r.text,
      likeCount: r.likeCount ?? 0,
      publishedAt: (r.publishedAt ?? new Date()).toISOString(),
      category: r.category ?? "ignore",
      confidence: r.confidence ?? 0,
      draftReply: r.draft ?? undefined,
      draftVoice: r.draftVoice ?? undefined,
      status: "pending",
      opportunityType: r.oppType ?? undefined,
      opportunityScore: r.oppScore ?? undefined,
      isQuestion: r.isQuestion,
      spamSignature: r.spamSignature,
      authorOffenseCount: r.offenseCount ?? 0,
      authorBlocked: r.blocked ?? false,
      isReply: !!r.parentCommentId,
      triageError: r.triageError,
    }));

    // Spam clusters (SPEC 5, signature 1): other flagged spam in the same thread.
    const spamByThread = new Map<string, string[]>();
    rows.forEach((r, i) => {
      if (r.category === "delete_spam" && r.threadId) {
        spamByThread.set(r.threadId, [...(spamByThread.get(r.threadId) ?? []), items[i].id]);
      }
    });
    rows.forEach((r, i) => {
      const group = r.threadId ? spamByThread.get(r.threadId) : undefined;
      if (r.category === "delete_spam" && group && group.length > 1) {
        items[i].clusterWith = group.filter((id) => id !== items[i].id);
      }
    });

    const counts: Partial<Record<ChannelKey, UnansweredCounts>> = {};
    for (const key of accessible) counts[key] = unansweredCounts(items.filter((i) => i.channel === key));

    return { dbOk: true, items: sortBacklog(items), counts, truncated: rows.length >= LIMIT };
  } catch {
    return empty;
  }
}
