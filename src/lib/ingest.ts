// DB-backed ingestion orchestration (SPEC Section 8, item 3).
//
// A sync has two phases so a big backlog never times out a single request:
//
//   1. fetch (cheap, YouTube quota only): pull every thread in the backlog
//      window (default 90 days), apply the pure partition rules in
//      ingest-core.ts, and store every new viewer comment right away:
//        - already answered by a host  -> stored as resolved, never sent to Claude
//        - from a blocked author       -> hidden (reversible) before categorization
//        - everything else             -> stored as pending, waiting for triage
//      Stored pending comments whose thread a host has since answered (on
//      YouTube directly or through the app) are resolved.
//
//   2. triage (Claude spend): categorize, draft `respond` replies, auto-hide
//      graduated spam, and fire opportunity pings, newest first, until the
//      request's time budget runs out. Whatever is left waits for the next
//      sync; "Sync now" keeps calling triage-only rounds until it is done.
//
// Every call writes one sync_runs row per channel, which the connection-health
// panel reads (last successful sync, comments pulled, last error).
//
// Mock mode (local dev only, see youtube.ts) lets this run end to end without
// a channel token. In production a channel without a token reports
// "not connected" instead.

import { and, asc, desc, eq, inArray, isNull, like, lt, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  actionLog,
  authors,
  channels,
  commentReviews,
  comments,
  syncRuns,
  type Channel,
} from "@/db";
import { categorizeComment, describeClaudeError, draftReply } from "./anthropic";
import { recordOffense } from "./authors";
import { clientForChannel, noteTokenHealth } from "./channel-client";
import { CHANNELS, hostChannelIds, type ChannelKey } from "./domain";
import { ENV } from "./env";
import { loadGraduationState } from "./graduation-data";
import { shouldAutoHideSpam, type GraduationState } from "./graduation";
import {
  backlogCutoff,
  buildThreadContext,
  detectHiddenLinks,
  normalizeChannelUrl,
  partitionForIngest,
  threadsNeedingFullReplies,
  type NormalizedComment,
} from "./ingest-core";
import { notifyOpportunity } from "./notify";
import { REVERSIBLE_HIDE, type RawCommentThread, type YouTubeClient } from "./youtube";
import { YouTubeApiError, friendlyYouTubeError } from "./youtube-errors";

export type SyncTrigger = "cron" | "manual";
export type SyncPhase = "full" | "triage";

export type SyncSummary = {
  channel: ChannelKey;
  ok: boolean;
  phase: SyncPhase;
  commentsFetched: number;
  newComments: number;
  resolved: number;
  autoHidden: number;
  triaged: number;
  notified: number;
  // Comments stored but not yet triaged by Claude.
  remaining: number;
  error?: string;
  errorKind?: string;
};

const BACKLOG_DAYS = 90;
// Threads whose inline replies are truncated get a full reply fetch (1 quota
// unit each) so host replies past the first five are not missed.
const MAX_FULL_REPLY_FETCHES = 60;
const TRIAGE_CONCURRENCY = 3;
const MAX_TRIAGE_ATTEMPTS = 3;
// Leave room for one more categorize + draft before the function limit.
const TRIAGE_SAFETY_MS = 15_000;

/** Run a sync across channels inside one request's time budget. */
export async function runSync(
  keys: ChannelKey[],
  opts: { trigger: SyncTrigger; phase: SyncPhase; budgetMs: number },
): Promise<SyncSummary[]> {
  const deadline = Date.now() + opts.budgetMs;
  const ctxs: ChannelCtx[] = [];
  const summaries: SyncSummary[] = [];

  // Phase 1 for every channel first, so one channel's triage cannot starve
  // the other channel's fetch.
  for (const key of keys) {
    const ctx = await startChannel(key, opts.trigger, opts.phase);
    ctxs.push(ctx);
    if (ctx.summary.ok && opts.phase === "full") await fetchPhase(ctx);
  }

  let graduation: GraduationState | null = null;
  try {
    graduation = await loadGraduationState();
  } catch {
    graduation = null; // no autopilot if the state cannot be read
  }

  // Phase 2: split the remaining time across channels that can triage.
  const triageable = ctxs.filter((c) => c.summary.ok || c.allowTriageWithoutYouTube);
  for (let i = 0; i < triageable.length; i++) {
    const ctx = triageable[i];
    const share = (deadline - Date.now()) / (triageable.length - i);
    await triagePhase(ctx, Date.now() + share, graduation);
  }

  for (const ctx of ctxs) {
    await finishChannel(ctx);
    summaries.push(ctx.summary);
  }
  return summaries;
}

type ChannelCtx = {
  key: ChannelKey;
  row: Channel | null;
  runId: number | null;
  client: YouTubeClient | null;
  summary: SyncSummary;
  // Triage only needs YouTube for auto-hides, so a token problem should not
  // stop Claude from working through already-stored comments.
  allowTriageWithoutYouTube: boolean;
  // Reviews whose triage failed during this run: retried on a later sync,
  // not again in this one.
  failedThisRun: number[];
};

async function startChannel(key: ChannelKey, trigger: SyncTrigger, phase: SyncPhase): Promise<ChannelCtx> {
  const meta = CHANNELS[key];
  const summary: SyncSummary = {
    channel: key,
    ok: true,
    phase,
    commentsFetched: 0,
    newComments: 0,
    resolved: 0,
    autoHidden: 0,
    triaged: 0,
    notified: 0,
    remaining: 0,
  };
  const ctx: ChannelCtx = { key, row: null, runId: null, client: null, summary, allowTriageWithoutYouTube: false, failedThisRun: [] };

  const [row] = await db.select().from(channels).where(eq(channels.platformChannelId, meta.platformChannelId));
  if (!row) {
    setError(ctx, "not_seeded", `${meta.displayName} is missing from the channels table. Redeploy so the seed runs.`);
    return ctx;
  }
  ctx.row = row;

  const [run] = await db.insert(syncRuns).values({ channelId: row.id, trigger, phase }).returning({ id: syncRuns.id });
  ctx.runId = run.id;

  try {
    ctx.client = clientForChannel(row);
  } catch (err) {
    setError(ctx, err instanceof YouTubeApiError ? err.kind : "other", friendlyYouTubeError(err, meta.displayName));
    await noteTokenHealth(row.id, meta.displayName, err);
    ctx.allowTriageWithoutYouTube = true;
  }
  return ctx;
}

function setError(ctx: ChannelCtx, kind: string, message: string) {
  ctx.summary.ok = false;
  ctx.summary.errorKind = kind;
  ctx.summary.error = message;
}

async function finishChannel(ctx: ChannelCtx) {
  if (!ctx.row) return;
  try {
    ctx.summary.remaining = await countUntriaged(ctx.row.id);
  } catch {
    // keep last known
  }
  if (ctx.runId == null) return;
  const s = ctx.summary;
  await db
    .update(syncRuns)
    .set({
      finishedAt: new Date(),
      ok: s.ok,
      threadsFetched: 0,
      commentsFetched: s.commentsFetched,
      newComments: s.newComments,
      triaged: s.triaged,
      autoHidden: s.autoHidden,
      resolved: s.resolved,
      remaining: s.remaining,
      errorKind: s.errorKind ?? null,
      errorMessage: s.error ?? null,
    })
    .where(eq(syncRuns.id, ctx.runId));
}

export async function countUntriaged(channelId: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(commentReviews)
    .innerJoin(comments, eq(commentReviews.commentId, comments.id))
    .where(
      and(
        eq(comments.channelId, channelId),
        eq(commentReviews.status, "pending"),
        isNull(commentReviews.category),
        lt(commentReviews.triageAttempts, MAX_TRIAGE_ATTEMPTS),
      ),
    );
  return r?.n ?? 0;
}

// ---------------------------------------------------------------- fetch phase

async function fetchPhase(ctx: ChannelCtx) {
  const row = ctx.row!;
  const client = ctx.client!;
  const meta = CHANNELS[ctx.key];
  try {
    if (!client.mock) await purgeSampleRows(row.id);

    const threads = await client.listChannelThreads(meta.platformChannelId, {
      publishedAfter: backlogCutoff(new Date(), BACKLOG_DAYS),
    });
    await completeTruncatedThreads(client, threads);
    // A successful authenticated read proves the token works.
    await noteTokenHealth(row.id, meta.displayName, null);

    const fetchedIds = threads.flatMap((t) => [t.topComment.id, ...t.replies.map((r) => r.id)]);
    ctx.summary.commentsFetched = fetchedIds.length;

    const existingIds = new Set<string>();
    for (const chunk of chunks(fetchedIds, 1000)) {
      const rows = await db
        .select({ id: comments.platformCommentId })
        .from(comments)
        .where(inArray(comments.platformCommentId, chunk));
      rows.forEach((r) => existingIds.add(r.id));
    }

    // Blocked authors on this channel (SPEC Section 5). Only blocked = true.
    const blockedRows = await db
      .select({ id: authors.platformAuthorId, url: authors.channelUrl })
      .from(authors)
      .where(and(eq(authors.channelId, row.id), eq(authors.blocked, true)));
    const blocked = {
      ids: new Set(blockedRows.map((b) => b.id).filter((v): v is string => !!v)),
      urls: new Set(blockedRows.map((b) => b.url).filter((v): v is string => !!v).map(normalizeChannelUrl)),
    };

    const part = partitionForIngest({
      threads,
      existingCommentIds: existingIds,
      blocked,
      host: {
        channelIds: hostChannelIds(ENV.extraHostChannelIds),
        urls: Object.values(CHANNELS).map((c) => `youtube.com/${c.handle}`),
      },
    });

    // Video titles for new comments and for stored comments still missing one.
    const newOnes = [...part.toQueue, ...part.toResolve, ...part.toAutoHide];
    const missingTitleRows = await db
      .selectDistinct({ videoId: comments.videoId })
      .from(comments)
      .where(and(eq(comments.channelId, row.id), isNull(comments.videoTitle)))
      .limit(100);
    const videoIds = [...new Set([...newOnes.map((c) => c.videoId), ...missingTitleRows.map((r) => r.videoId)])];
    let titles: Record<string, string> = {};
    try {
      titles = videoIds.length ? await client.videoTitles(videoIds) : {};
    } catch {
      titles = {}; // titles are a nicety; never fail the sync over them
    }
    for (const r of missingTitleRows) {
      if (titles[r.videoId]) {
        await db
          .update(comments)
          .set({ videoTitle: titles[r.videoId] })
          .where(and(eq(comments.videoId, r.videoId), isNull(comments.videoTitle)));
      }
    }

    const now = new Date();
    // Answered by a host already: store as resolved, no Claude spend.
    const resolvedIds = await insertComments(row.id, part.toResolve, titles);
    await insertReviews(resolvedIds, { status: "resolved", reviewedBy: "system:host-reply", reviewedAt: now });
    // Unanswered: store as pending, category null until triage.
    const queuedIds = await insertComments(row.id, part.toQueue, titles);
    await insertReviews(queuedIds, { status: "pending" });
    ctx.summary.newComments = part.toQueue.length + part.toResolve.length + part.toAutoHide.length;

    // Blocked authors: hide before categorization (reversible hide).
    if (part.toAutoHide.length) await autoHideBlocked(ctx, part.toAutoHide, titles);

    // Stored comments a host has since answered: resolve the pending ones.
    let resolvedCount = part.toResolve.length;
    for (const chunk of chunks(part.answeredExistingIds, 500)) {
      const updated = await db
        .update(commentReviews)
        .set({ status: "resolved", reviewedBy: "system:host-reply", reviewedAt: now })
        .where(
          and(
            eq(commentReviews.status, "pending"),
            inArray(
              commentReviews.commentId,
              db.select({ id: comments.id }).from(comments).where(inArray(comments.platformCommentId, chunk)),
            ),
          ),
        )
        .returning({ id: commentReviews.id });
      resolvedCount += updated.length;
      if (updated.length) {
        await db.insert(actionLog).values(
          updated.map((u) => ({ commentReviewId: u.id, actionType: "resolved_by_host_reply", performedBy: "system" })),
        );
      }
    }
    ctx.summary.resolved = resolvedCount;
  } catch (err) {
    setError(ctx, err instanceof YouTubeApiError ? err.kind : "other", friendlyYouTubeError(err, meta.displayName));
    await noteTokenHealth(row.id, meta.displayName, err);
    ctx.allowTriageWithoutYouTube = true;
  }
}

async function completeTruncatedThreads(client: YouTubeClient, threads: RawCommentThread[]) {
  const truncated = threadsNeedingFullReplies(threads).slice(0, MAX_FULL_REPLY_FETCHES);
  for (const t of truncated) {
    try {
      const all = await client.listReplies(t.threadId, t.topComment.videoId);
      if (all.length >= t.replies.length) t.replies = all;
    } catch (err) {
      if (err instanceof YouTubeApiError && (err.kind === "quota" || err.needsReconnect)) throw err;
      // Otherwise keep the inline replies for this thread.
    }
  }
}

/** Delete local sample rows (pre-0001 mock "c1" and "mock-" ids) once a real token is in use. */
async function purgeSampleRows(channelId: number) {
  const sampleComments = db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.channelId, channelId),
        or(
          like(comments.platformCommentId, "mock-%"),
          and(eq(comments.platformCommentId, "c1"), eq(comments.videoId, "vid_policy")),
        ),
      ),
    );
  const reviewIds = db.select({ id: commentReviews.id }).from(commentReviews).where(inArray(commentReviews.commentId, sampleComments));
  await db.delete(actionLog).where(inArray(actionLog.commentReviewId, reviewIds));
  await db.delete(commentReviews).where(inArray(commentReviews.commentId, sampleComments));
  await db
    .delete(comments)
    .where(
      and(
        eq(comments.channelId, channelId),
        or(
          like(comments.platformCommentId, "mock-%"),
          and(eq(comments.platformCommentId, "c1"), eq(comments.videoId, "vid_policy")),
        ),
      ),
    );
}

async function insertComments(
  channelId: number,
  list: NormalizedComment[],
  titles: Record<string, string>,
): Promise<number[]> {
  const ids: number[] = [];
  for (const chunk of chunks(list, 200)) {
    const rows = await db
      .insert(comments)
      .values(chunk.map((c) => commentRow(channelId, c, titles[c.videoId] ?? null)))
      .onConflictDoNothing()
      .returning({ id: comments.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

async function insertReviews(
  commentIds: number[],
  fields: { status: "pending" | "resolved"; reviewedBy?: string; reviewedAt?: Date },
) {
  for (const chunk of chunks(commentIds, 500)) {
    await db.insert(commentReviews).values(chunk.map((commentId) => ({ commentId, ...fields })));
  }
}

async function autoHideBlocked(ctx: ChannelCtx, list: NormalizedComment[], titles: Record<string, string>) {
  const row = ctx.row!;
  const client = ctx.client!;
  const ids = await insertComments(row.id, list, titles);
  if (ids.length === 0) return;
  const stored = await db
    .select({ id: comments.id, pid: comments.platformCommentId })
    .from(comments)
    .where(inArray(comments.id, ids));
  const byPid = new Map(stored.map((s) => [s.pid, s.id]));
  const now = new Date();
  try {
    const res = await client.setModerationStatus(stored.map((s) => s.pid), REVERSIBLE_HIDE);
    for (const c of list) {
      const commentId = byPid.get(c.id);
      if (!commentId) continue;
      const [rev] = await db
        .insert(commentReviews)
        .values({
          commentId,
          status: "deleted",
          autoActioned: true,
          reviewedBy: "system",
          reviewedAt: now,
          actionTakenAt: now,
        })
        .returning({ id: commentReviews.id });
      await db.insert(actionLog).values({
        commentReviewId: rev.id,
        actionType: "auto_hide_blocked_author",
        performedBy: "system",
        detail: { method: REVERSIBLE_HIDE, mocked: !!res.mocked },
      });
      await recordOffense(
        { channelId: row.id, platformAuthorId: c.authorChannelId, channelUrl: c.authorChannelUrl, displayName: c.authorDisplayName },
        "hide",
        { commentId: c.id },
      );
    }
    ctx.summary.autoHidden += list.length;
  } catch (err) {
    // Could not hide: queue them for a human instead, flagged as troll.
    const note = `Blocked author, but the automatic hide failed: ${friendlyYouTubeError(err, CHANNELS[ctx.key].displayName)}`;
    await db.insert(commentReviews).values(
      [...byPid.values()].map((commentId) => ({
        commentId,
        status: "pending" as const,
        category: "delete_troll" as const,
        confidenceScore: 1,
        triageError: note,
      })),
    );
    if (err instanceof YouTubeApiError && err.needsReconnect) throw err;
  }
}

function commentRow(channelId: number, c: NormalizedComment, videoTitle: string | null) {
  return {
    channelId,
    videoId: c.videoId,
    videoTitle,
    platformCommentId: c.id,
    author: c.authorDisplayName,
    authorChannelUrl: c.authorChannelUrl,
    authorChannelId: c.authorChannelId,
    text: c.text,
    textHtml: c.textHtml,
    likeCount: c.likeCount,
    publishedAt: new Date(c.publishedAt),
    parentCommentId: c.parentId,
    threadId: c.threadId,
  };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// --------------------------------------------------------------- triage phase

type TriageItem = {
  reviewId: number;
  commentId: number;
  platformCommentId: string;
  threadId: string | null;
  videoId: string;
  videoTitle: string | null;
  author: string | null;
  authorChannelId: string | null;
  authorChannelUrl: string | null;
  text: string;
  textHtml: string | null;
  attempts: number;
};

async function triagePhase(ctx: ChannelCtx, deadline: number, graduation: GraduationState | null) {
  const row = ctx.row;
  if (!row) return;
  let stop = false;
  while (!stop && Date.now() < deadline - TRIAGE_SAFETY_MS) {
    const batch = await claimTriageBatch(row.id, TRIAGE_CONCURRENCY, ctx.failedThisRun);
    if (batch.length === 0) break;
    const results = await Promise.all(batch.map((item) => triageOne(ctx, item, graduation)));
    for (const r of results) {
      if (r.fatal) {
        stop = true;
        setError(ctx, "claude", r.fatal);
      }
    }
  }
}

async function claimTriageBatch(channelId: number, n: number, exclude: number[]): Promise<TriageItem[]> {
  const candidates = await db
    .select({
      reviewId: commentReviews.id,
      commentId: comments.id,
      platformCommentId: comments.platformCommentId,
      threadId: comments.threadId,
      videoId: comments.videoId,
      videoTitle: comments.videoTitle,
      author: comments.author,
      authorChannelId: comments.authorChannelId,
      authorChannelUrl: comments.authorChannelUrl,
      text: comments.text,
      textHtml: comments.textHtml,
      attempts: commentReviews.triageAttempts,
    })
    .from(commentReviews)
    .innerJoin(comments, eq(commentReviews.commentId, comments.id))
    .where(
      and(
        eq(comments.channelId, channelId),
        eq(commentReviews.status, "pending"),
        isNull(commentReviews.category),
        lt(commentReviews.triageAttempts, MAX_TRIAGE_ATTEMPTS),
        or(isNull(commentReviews.claimedAt), lt(commentReviews.claimedAt, sql`now() - interval '3 minutes'`)),
        exclude.length ? notInArray(commentReviews.id, exclude) : undefined,
      ),
    )
    .orderBy(desc(comments.publishedAt), asc(commentReviews.id))
    .limit(n * 2);

  const claimed: TriageItem[] = [];
  for (const c of candidates) {
    if (claimed.length >= n) break;
    const ok = await db
      .update(commentReviews)
      .set({ claimedBy: "triage", claimedAt: new Date() })
      .where(
        and(
          eq(commentReviews.id, c.reviewId),
          isNull(commentReviews.category),
          or(isNull(commentReviews.claimedAt), lt(commentReviews.claimedAt, sql`now() - interval '3 minutes'`)),
        ),
      )
      .returning({ id: commentReviews.id });
    if (ok.length) claimed.push(c);
  }
  return claimed;
}

async function triageOne(
  ctx: ChannelCtx,
  item: TriageItem,
  graduation: GraduationState | null,
): Promise<{ fatal?: string }> {
  const meta = CHANNELS[ctx.key];
  const row = ctx.row!;
  try {
    const siblings = item.threadId
      ? await db
          .select({ id: comments.platformCommentId, author: comments.author, text: comments.text, parent: comments.parentCommentId })
          .from(comments)
          .where(eq(comments.threadId, item.threadId))
          .orderBy(asc(comments.publishedAt))
          .limit(12)
      : [];
    const threadContext = buildThreadContext(
      item.platformCommentId,
      siblings.map((s) => ({ id: s.id, author: s.author, text: s.text, isTop: !s.parent })),
    );

    const result = await categorizeComment({
      channelName: meta.displayName,
      videoTitle: item.videoTitle,
      text: item.text,
      threadContext,
      linkSignals: detectHiddenLinks(item.textHtml),
    });

    let category = result.category;
    let draftText: string | null = null;
    let draftVoice: "josh" | "jeb" | "house" | null = null;
    if (category === "respond") {
      const d = await draftReply({ channelKey: ctx.key, channelName: meta.displayName, videoTitle: item.videoTitle, text: item.text });
      if (d.political) {
        category = "flag_political"; // SPEC 5: political overrides respond, never drafted
      } else {
        draftText = d.draft;
        draftVoice = d.voice;
      }
    }
    // Reply-to-a-reply: address the person, the way YouTube's own UI does.
    if (draftText && item.author && item.threadId && item.threadId !== item.platformCommentId && !draftText.startsWith("@")) {
      draftText = `${item.author.startsWith("@") ? item.author : `@${item.author}`} ${draftText}`;
    }

    const review = {
      category,
      confidence: result.confidence,
      spamSignature: category === "delete_spam" ? result.spamSignature ?? "other" : null,
    };
    const isPolitical = category === "flag_political";
    const fields = {
      category,
      confidenceScore: result.confidence,
      draftReplyText: draftText,
      draftVoice,
      // Spam, troll, and political are never opportunities (SPEC 8a).
      opportunityType: isPolitical || category.startsWith("delete_") ? ("none" as const) : result.opportunityType,
      opportunityScore: isPolitical || category.startsWith("delete_") ? 0 : result.opportunityScore,
      spamSignature: review.spamSignature,
      isQuestion: result.isQuestion ?? null,
      triageError: null,
      claimedBy: null,
      claimedAt: null,
    };

    // Graduated spam: hide automatically (SPEC 7), reversible, logged.
    if (graduation && ctx.client && shouldAutoHideSpam(review, graduation)) {
      try {
        const res = await ctx.client.setModerationStatus([item.platformCommentId], REVERSIBLE_HIDE);
        const now = new Date();
        await db
          .update(commentReviews)
          .set({ ...fields, status: "deleted", autoActioned: true, reviewedBy: "system", reviewedAt: now, actionTakenAt: now })
          .where(eq(commentReviews.id, item.reviewId));
        await db.insert(actionLog).values({
          commentReviewId: item.reviewId,
          actionType: "auto_hide_spam",
          performedBy: "system",
          detail: { method: REVERSIBLE_HIDE, signature: review.spamSignature, confidence: result.confidence, mocked: !!res.mocked },
        });
        await recordOffense(
          { channelId: row.id, platformAuthorId: item.authorChannelId, channelUrl: item.authorChannelUrl, displayName: item.author },
          "hide",
          { commentId: item.platformCommentId },
        );
        ctx.summary.autoHidden++;
        ctx.summary.triaged++;
        return {};
      } catch (err) {
        // Fall through: leave it in the queue for a human.
        await noteTokenHealth(row.id, meta.displayName, err);
        (fields as { triageError: string | null }).triageError = `Spam autopilot could not hide this: ${friendlyYouTubeError(err, meta.displayName)}`;
      }
    }

    await db.update(commentReviews).set(fields).where(eq(commentReviews.id, item.reviewId));
    ctx.summary.triaged++;

    if (!isPolitical && !category.startsWith("delete_")) {
      const outcome = await notifyOpportunity({
        channel: ctx.key,
        videoId: item.videoId,
        videoTitle: item.videoTitle,
        author: item.author ?? "viewer",
        authorChannelUrl: item.authorChannelUrl,
        text: item.text,
        platformCommentId: item.platformCommentId,
        opportunityType: fields.opportunityType,
        opportunityScore: fields.opportunityScore,
      });
      if (outcome.sent) {
        ctx.summary.notified++;
        await db.update(commentReviews).set({ notifiedAt: new Date() }).where(eq(commentReviews.id, item.reviewId));
      }
    }
    return {};
  } catch (err) {
    const { message, fatal } = describeClaudeError(err);
    ctx.failedThisRun.push(item.reviewId);
    await db
      .update(commentReviews)
      .set({
        // A fatal error (bad key, bad model) is not this comment's fault.
        triageAttempts: fatal ? item.attempts : item.attempts + 1,
        triageError: message,
        claimedBy: null,
        claimedAt: null,
      })
      .where(eq(commentReviews.id, item.reviewId));
    return fatal ? { fatal: message } : {};
  }
}
