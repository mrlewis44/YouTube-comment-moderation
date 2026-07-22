// DB-backed ingestion orchestration (SPEC Section 8, item 3). For each
// connected channel: pull recent threads, apply the pure partition rules
// (dedup, host-reply resolution, blocked-author auto-delete), then persist,
// categorize, draft replies for `respond`, and fire opportunity notifications.
//
// Runs live only with a DB, channel tokens, and an Anthropic key. Until then
// the YouTube client falls back to mock reads (see youtube.ts) so the pipeline
// can be exercised end to end without external state.

import { eq, inArray } from "drizzle-orm";
import { db, channels, comments, commentReviews, authors, actionLog } from "@/db";
import { decryptToken } from "./crypto";
import { YouTubeClient } from "./youtube";
import { categorizeComment, draftReply } from "./anthropic";
import { notifyOpportunity } from "./notify";
import { backlogCutoff, partitionForIngest } from "./ingest-core";
import { CHANNELS, type ChannelKey } from "./domain";

export type IngestSummary = {
  channel: ChannelKey;
  queued: number;
  autoDeleted: number;
  resolvedThreads: number;
  duplicates: number;
  notified: number;
  remaining: number;
};

// Cap the Claude-categorization work per run so a single invocation stays well
// under the 60s function limit. The rest are picked up on the next sync/cron
// (they are not yet stored, so they re-surface as new). Keeps the first
// backfill from timing out on a large backlog.
const MAX_PER_RUN = 15;

export async function ingestChannel(
  channelKey: ChannelKey,
  opts: { backlogDays?: number } = {},
): Promise<IngestSummary> {
  const meta = CHANNELS[channelKey];
  const [row] = await db
    .select()
    .from(channels)
    .where(eq(channels.platformChannelId, meta.platformChannelId));
  if (!row) throw new Error(`Channel ${channelKey} not connected`);

  const client = new YouTubeClient(
    row.oauthRefreshToken ? decryptToken(row.oauthRefreshToken) : null,
  );

  const cutoff = backlogCutoff(new Date(), opts.backlogDays ?? 90);
  const threads = await client.listChannelThreads(meta.platformChannelId, {
    publishedAfter: cutoff,
  });

  // Existing ids to dedup against.
  const fetchedIds = threads.flatMap((t) => [t.topComment.id, ...t.replies.map((r) => r.id)]);
  const existing =
    fetchedIds.length > 0
      ? await db
          .select({ id: comments.platformCommentId })
          .from(comments)
          .where(inArray(comments.platformCommentId, fetchedIds))
      : [];
  const existingIds = new Set(existing.map((e) => e.id));

  // Blocked authors on this channel (SPEC Section 5).
  const blockedRows = await db
    .select({ url: authors.channelUrl })
    .from(authors)
    .where(eq(authors.channelId, row.id));
  const blockedAuthorUrls = new Set(
    blockedRows.map((b) => b.url).filter((u): u is string => !!u),
  );

  const part = partitionForIngest({
    threads,
    existingCommentIds: existingIds,
    blockedAuthorUrls,
    ownerChannelUrls: [meta.handle, `https://youtube.com/${meta.handle}`],
  });

  let notified = 0;

  // Blocked-author comments: hide immediately, log, do not queue.
  for (const c of part.toAutoDelete) {
    await client.setModerationStatus(c.id, "rejected");
    const [ins] = await db
      .insert(comments)
      .values(commentRow(row.id, c))
      .onConflictDoNothing()
      .returning({ id: comments.id });
    if (ins) {
      const [rev] = await db
        .insert(commentReviews)
        .values({ commentId: ins.id, category: "delete_spam", status: "deleted", actionTakenAt: new Date() })
        .returning({ id: commentReviews.id });
      await db.insert(actionLog).values({
        commentReviewId: rev.id,
        actionType: "auto_delete_blocked_author",
        performedBy: "system",
      });
    }
  }

  // New comments: store, categorize, draft, notify. Capped per run.
  const toProcess = part.toQueue.slice(0, MAX_PER_RUN);
  for (const c of toProcess) {
    const [ins] = await db
      .insert(comments)
      .values(commentRow(row.id, c))
      .onConflictDoNothing()
      .returning({ id: comments.id });
    if (!ins) continue;

    const result = await categorizeComment({
      channelName: meta.displayName,
      videoTitle: null,
      text: c.text,
    });

    let draftText: string | null = null;
    let draftVoice: "josh" | "jeb" | "house" | null = null;
    if (result.category === "respond") {
      const d = await draftReply({
        channelKey,
        channelName: meta.displayName,
        videoTitle: null,
        text: c.text,
      });
      draftText = d.draft;
      draftVoice = d.voice;
    }

    await db.insert(commentReviews).values({
      commentId: ins.id,
      category: result.category,
      confidenceScore: result.confidence,
      draftReplyText: draftText,
      draftVoice,
      opportunityType: result.opportunityType,
      opportunityScore: result.opportunityScore,
      status: "pending",
    });

    const outcome = await notifyOpportunity({
      channel: channelKey,
      videoId: c.videoId,
      videoTitle: null,
      author: c.authorDisplayName,
      authorChannelUrl: c.authorChannelUrl,
      text: c.text,
      platformCommentId: c.id,
      opportunityType: result.opportunityType,
      opportunityScore: result.opportunityScore,
    });
    if (outcome.sent) {
      notified++;
      await db
        .update(commentReviews)
        .set({ notifiedAt: new Date() })
        .where(eq(commentReviews.commentId, ins.id));
    }
  }

  return {
    channel: channelKey,
    queued: toProcess.length,
    autoDeleted: part.toAutoDelete.length,
    resolvedThreads: part.resolvedThreadIds.length,
    duplicates: part.skippedDuplicates,
    notified,
    remaining: Math.max(0, part.toQueue.length - toProcess.length),
  };
}

function commentRow(channelId: number, c: { id: string; videoId: string; authorDisplayName: string; authorChannelUrl: string | null; text: string; likeCount: number; publishedAt: string; parentId: string | null }) {
  return {
    channelId,
    videoId: c.videoId,
    platformCommentId: c.id,
    author: c.authorDisplayName,
    authorChannelUrl: c.authorChannelUrl,
    text: c.text,
    likeCount: c.likeCount,
    publishedAt: new Date(c.publishedAt),
    parentCommentId: c.parentId,
  };
}
