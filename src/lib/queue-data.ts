// Loads the live review queue from the database: pending comments joined with
// their categorization/draft, mapped into the same shape the queue UI already
// renders (MockComment). Returns [] on any failure (DB not provisioned yet,
// tables missing), so the page can fall back to the sample comments.

import { and, desc, eq, inArray } from "drizzle-orm";
import { CHANNELS, type ChannelKey } from "./domain";
import type { MockComment } from "./mock";

// platformChannelId -> channel key.
const KEY_BY_PLATFORM_ID: Record<string, ChannelKey> = Object.fromEntries(
  (Object.keys(CHANNELS) as ChannelKey[]).map((k) => [CHANNELS[k].platformChannelId, k]),
);

export async function loadQueue(accessible: ChannelKey[]): Promise<MockComment[]> {
  if (accessible.length === 0) return [];
  const platformIds = accessible.map((k) => CHANNELS[k].platformChannelId);

  try {
    const { db, comments, commentReviews, channels } = await import("@/db");
    const rows = await db
      .select({
        reviewId: commentReviews.id,
        category: commentReviews.category,
        confidence: commentReviews.confidenceScore,
        draft: commentReviews.draftReplyText,
        draftVoice: commentReviews.draftVoice,
        oppType: commentReviews.opportunityType,
        oppScore: commentReviews.opportunityScore,
        status: commentReviews.status,
        text: comments.text,
        author: comments.author,
        videoTitle: comments.videoTitle,
        likeCount: comments.likeCount,
        publishedAt: comments.publishedAt,
        platformChannelId: channels.platformChannelId,
      })
      .from(commentReviews)
      .innerJoin(comments, eq(commentReviews.commentId, comments.id))
      .innerJoin(channels, eq(comments.channelId, channels.id))
      .where(
        and(
          eq(commentReviews.status, "pending"),
          inArray(channels.platformChannelId, platformIds),
        ),
      )
      .orderBy(desc(comments.publishedAt))
      .limit(200);

    return rows.map((r) => ({
      id: `r${r.reviewId}`,
      channel: KEY_BY_PLATFORM_ID[r.platformChannelId] ?? accessible[0],
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
    }));
  } catch {
    return [];
  }
}
