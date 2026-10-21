// Read-only loaders for the dashboard panels: per-channel connection health,
// the action log (including the "recently auto-actioned" view, SPEC Section 7),
// and the authors list (repeat offenders and blocked, SPEC Section 5).
// Each loader is resilient: on failure it returns null/empty so the page
// still renders.

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { CHANNELS, channelKeyForPlatformId, type ChannelKey } from "./domain";
import { BLOCK_SURFACE_OFFENSES } from "./moderation-rules";

export type ChannelHealth = {
  key: ChannelKey;
  displayName: string;
  handle: string;
  connected: boolean;
  connectedBy: string | null;
  connectedAt: string | null;
  tokenError: string | null;
  tokenErrorAt: string | null;
  lastSuccessAt: string | null; // last full sync that completed without error
  lastFetched: number | null; // comments seen in the 90-day window on that sync
  lastNew: number | null; // of those, new to the app
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastError: string | null; // most recent failure, only if after the last success
  lastErrorAt: string | null;
  untriaged: number; // stored, waiting for Claude
  stored90d: number; // viewer comments stored from the last 90 days
};

export async function loadChannelHealth(accessible: ChannelKey[]): Promise<ChannelHealth[] | null> {
  try {
    const { db, channels, syncRuns, comments } = await import("@/db");
    const { countUntriaged } = await import("./ingest");
    const out: ChannelHealth[] = [];
    for (const key of accessible) {
      const meta = CHANNELS[key];
      const [row] = await db.select().from(channels).where(eq(channels.platformChannelId, meta.platformChannelId));
      const base: ChannelHealth = {
        key,
        displayName: meta.displayName,
        handle: meta.handle,
        connected: false,
        connectedBy: null,
        connectedAt: null,
        tokenError: null,
        tokenErrorAt: null,
        lastSuccessAt: null,
        lastFetched: null,
        lastNew: null,
        lastRunAt: null,
        lastRunOk: null,
        lastError: null,
        lastErrorAt: null,
        untriaged: 0,
        stored90d: 0,
      };
      if (!row) {
        out.push(base);
        continue;
      }
      const [lastOk] = await db
        .select()
        .from(syncRuns)
        .where(and(eq(syncRuns.channelId, row.id), eq(syncRuns.ok, true), eq(syncRuns.phase, "full")))
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);
      const [lastRun] = await db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.channelId, row.id))
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);
      const [lastFail] = await db
        .select()
        .from(syncRuns)
        .where(and(eq(syncRuns.channelId, row.id), eq(syncRuns.ok, false)))
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);
      const [stored] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(comments)
        .where(and(eq(comments.channelId, row.id), gte(comments.publishedAt, sql`now() - interval '90 days'`)));

      const failIsCurrent = lastFail && (!lastOk || lastFail.startedAt > lastOk.startedAt);
      out.push({
        ...base,
        connected: !!row.oauthRefreshToken,
        connectedBy: row.connectedBy,
        connectedAt: row.connectedAt?.toISOString() ?? null,
        tokenError: row.tokenError,
        tokenErrorAt: row.tokenErrorAt?.toISOString() ?? null,
        lastSuccessAt: (lastOk?.finishedAt ?? lastOk?.startedAt)?.toISOString() ?? null,
        lastFetched: lastOk?.commentsFetched ?? null,
        lastNew: lastOk?.newComments ?? null,
        lastRunAt: lastRun?.startedAt.toISOString() ?? null,
        lastRunOk: lastRun ? lastRun.ok : null,
        lastError: failIsCurrent ? lastFail.errorMessage : null,
        lastErrorAt: failIsCurrent ? lastFail.startedAt.toISOString() : null,
        untriaged: await countUntriaged(row.id),
        stored90d: stored?.n ?? 0,
      });
    }
    return out;
  } catch {
    return null;
  }
}

export type ActivityEntry = {
  id: number;
  reviewId: number;
  actionType: string;
  performedBy: string | null;
  performedAt: string;
  detail: Record<string, unknown> | null;
  channel: ChannelKey;
  author: string;
  text: string;
  videoTitle: string;
  videoId: string;
  platformCommentId: string;
  category: string | null;
  spamSignature: string | null;
  reviewStatus: string;
  // Restore is offered while the comment is still hidden by a reversible hide.
  canRestore: boolean;
};

const HIDE_TYPES = ["hide", "auto_hide_spam", "auto_hide_blocked_author"];

export async function loadActivity(accessible: ChannelKey[], opts: { autoOnly?: boolean; limit?: number } = {}) {
  try {
    const { db, actionLog, commentReviews, comments, channels } = await import("@/db");
    const platformIds = accessible.map((k) => CHANNELS[k].platformChannelId);
    if (platformIds.length === 0) return [];
    const where = opts.autoOnly
      ? and(inArray(channels.platformChannelId, platformIds), eq(actionLog.performedBy, "system"), inArray(actionLog.actionType, ["auto_hide_spam", "auto_hide_blocked_author"]))
      : inArray(channels.platformChannelId, platformIds);
    const rows = await db
      .select({
        id: actionLog.id,
        reviewId: actionLog.commentReviewId,
        actionType: actionLog.actionType,
        performedBy: actionLog.performedBy,
        performedAt: actionLog.performedAt,
        detail: actionLog.detail,
        platformChannelId: channels.platformChannelId,
        author: comments.author,
        text: comments.text,
        videoTitle: comments.videoTitle,
        videoId: comments.videoId,
        platformCommentId: comments.platformCommentId,
        category: commentReviews.category,
        spamSignature: commentReviews.spamSignature,
        reviewStatus: commentReviews.status,
      })
      .from(actionLog)
      .innerJoin(commentReviews, eq(actionLog.commentReviewId, commentReviews.id))
      .innerJoin(comments, eq(commentReviews.commentId, comments.id))
      .innerJoin(channels, eq(comments.channelId, channels.id))
      .where(where)
      .orderBy(desc(actionLog.performedAt))
      .limit(opts.limit ?? 60);

    return rows.map<ActivityEntry>((r) => {
      const detail = (r.detail as Record<string, unknown> | null) ?? null;
      return {
        id: r.id,
        reviewId: r.reviewId,
        actionType: r.actionType,
        performedBy: r.performedBy,
        performedAt: (r.performedAt ?? new Date()).toISOString(),
        detail,
        channel: channelKeyForPlatformId(r.platformChannelId) ?? accessible[0],
        author: r.author ?? "",
        text: r.text,
        videoTitle: r.videoTitle ?? "",
        videoId: r.videoId,
        platformCommentId: r.platformCommentId,
        category: r.category,
        spamSignature: r.spamSignature,
        reviewStatus: r.reviewStatus,
        canRestore: r.reviewStatus === "deleted" && HIDE_TYPES.includes(r.actionType) && detail?.method === "heldForReview",
      };
    });
  } catch {
    return null;
  }
}

export type AuthorEntry = {
  id: number;
  channel: ChannelKey;
  displayName: string;
  channelUrl: string | null;
  offenseCount: number;
  blocked: boolean;
  blockedAt: string | null;
  blockedBy: string | null;
  blockedReason: string | null;
  lastFlaggedAt: string | null;
};

export async function loadAuthors(accessible: ChannelKey[]): Promise<{ offenders: AuthorEntry[]; blocked: AuthorEntry[] } | null> {
  try {
    const { db, authors, channels } = await import("@/db");
    const platformIds = accessible.map((k) => CHANNELS[k].platformChannelId);
    if (platformIds.length === 0) return { offenders: [], blocked: [] };
    const rows = await db
      .select({ a: authors, platformChannelId: channels.platformChannelId })
      .from(authors)
      .innerJoin(channels, eq(authors.channelId, channels.id))
      .where(inArray(channels.platformChannelId, platformIds))
      .orderBy(desc(authors.lastFlaggedAt))
      .limit(500);
    const map = (r: (typeof rows)[number]): AuthorEntry => ({
      id: r.a.id,
      channel: channelKeyForPlatformId(r.platformChannelId) ?? accessible[0],
      displayName: r.a.displayName ?? "(unknown)",
      channelUrl: r.a.channelUrl,
      offenseCount: r.a.offenseCount,
      blocked: r.a.blocked,
      blockedAt: r.a.blockedAt?.toISOString() ?? null,
      blockedBy: r.a.blockedBy,
      blockedReason: r.a.blockedReason,
      lastFlaggedAt: r.a.lastFlaggedAt?.toISOString() ?? null,
    });
    return {
      offenders: rows.filter((r) => !r.a.blocked && r.a.offenseCount >= BLOCK_SURFACE_OFFENSES).map(map),
      blocked: rows.filter((r) => r.a.blocked).map(map),
    };
  } catch {
    return null;
  }
}
