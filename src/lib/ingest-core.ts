// Pure ingestion logic (no DB, no network) so the tricky rules from SPEC
// Section 8 (item 3) and Section 5 are unit-testable in isolation:
//   - flatten threads into individual comments
//   - dedup against already-stored comment ids
//   - a comment is "answered" once a host replied in its thread after it, so
//     it is stored as resolved instead of queued (and pending ones resolve)
//   - comments from blocked authors are auto-hidden before categorization
//   - hidden link injection signals (spam signature 2)
//
// The DB-backed orchestration in ingest.ts calls these, then persists.

import type { RawComment, RawCommentThread } from "./youtube";

export type NormalizedComment = RawComment & { threadId: string };

/** Flatten threads (top-level comment + its replies) into a flat list. */
export function flattenThreads(threads: RawCommentThread[]): NormalizedComment[] {
  const out: NormalizedComment[] = [];
  for (const t of threads) {
    out.push({ ...t.topComment, threadId: t.threadId });
    for (const r of t.replies) out.push({ ...r, threadId: t.threadId });
  }
  return out;
}

export type HostIdentity = {
  // YouTube channel ids that count as "the host" (both in-scope channels plus
  // any extra host channels). Compared against snippet.authorChannelId.
  channelIds: string[];
  // Fallback for rows without an author channel id: channel URLs or handles.
  // Compared after normalization (scheme, www, trailing slash, case).
  urls?: string[];
};

/** Normalize a YouTube channel URL or handle for comparison. */
export function normalizeChannelUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.|m\.)/, "")
    .replace(/^youtube\.com\//, "")
    .replace(/\/+$/, "");
}

export function isHostComment(c: Pick<RawComment, "authorChannelId" | "authorChannelUrl">, host: HostIdentity): boolean {
  if (c.authorChannelId && host.channelIds.includes(c.authorChannelId)) return true;
  if (c.authorChannelUrl && host.urls?.length) {
    const n = normalizeChannelUrl(c.authorChannelUrl);
    return host.urls.some((u) => normalizeChannelUrl(u) === n);
  }
  return false;
}

/**
 * Has a host answered this comment? SPEC Section 8 says a thread with a reply
 * from the channel's own account is resolved. Refined so a viewer who asks a
 * new question in the thread AFTER the host replied still counts as
 * unanswered: the top comment is answered by any host reply in its thread, a
 * reply is answered only by a host reply published after it.
 */
export function isAnsweredByHost(
  comment: Pick<RawComment, "id" | "publishedAt" | "parentId">,
  thread: RawCommentThread,
  host: HostIdentity,
): boolean {
  const hostReplies = thread.replies.filter((r) => r.id !== comment.id && isHostComment(r, host));
  if (hostReplies.length === 0) return false;
  if (!comment.parentId) return true;
  const t = Date.parse(comment.publishedAt);
  return hostReplies.some((r) => Date.parse(r.publishedAt) > t);
}

/** True if the thread has any host reply (kept for callers that need the thread view). */
export function threadHasHostReply(thread: RawCommentThread, host: HostIdentity): boolean {
  return [thread.topComment, ...thread.replies].some((c) => isHostComment(c, host));
}

export type BlockedAuthors = {
  ids: Set<string>; // author channel ids
  urls: Set<string>; // normalized channel urls (fallback)
};

export function isBlockedAuthor(c: Pick<RawComment, "authorChannelId" | "authorChannelUrl">, blocked: BlockedAuthors): boolean {
  if (c.authorChannelId && blocked.ids.has(c.authorChannelId)) return true;
  if (c.authorChannelUrl && blocked.urls.has(normalizeChannelUrl(c.authorChannelUrl))) return true;
  return false;
}

export type PartitionInput = {
  threads: RawCommentThread[];
  existingCommentIds: Set<string>;
  blocked: BlockedAuthors;
  host: HostIdentity;
};

export type PartitionResult = {
  // New, unanswered comments to store as pending and categorize.
  toQueue: NormalizedComment[];
  // New comments a host already answered: store as resolved, never categorize.
  toResolve: NormalizedComment[];
  // New comments from blocked authors: hide before they reach the queue
  // (SPEC Section 5 blocking policy).
  toAutoHide: NormalizedComment[];
  // Already-stored comments a host has now answered (pending ones resolve).
  answeredExistingIds: string[];
  // Already-stored comment ids we skipped.
  skippedDuplicates: number;
  // Host's own comments seen (never stored).
  hostComments: number;
};

export function partitionForIngest(input: PartitionInput): PartitionResult {
  const { threads, existingCommentIds, blocked, host } = input;
  const result: PartitionResult = {
    toQueue: [],
    toResolve: [],
    toAutoHide: [],
    answeredExistingIds: [],
    skippedDuplicates: 0,
    hostComments: 0,
  };

  for (const thread of threads) {
    for (const c of flattenThreads([thread])) {
      if (isHostComment(c, host)) {
        result.hostComments++;
        continue;
      }
      const answered = isAnsweredByHost(c, thread, host);
      if (existingCommentIds.has(c.id)) {
        result.skippedDuplicates++;
        if (answered) result.answeredExistingIds.push(c.id);
        continue;
      }
      if (isBlockedAuthor(c, blocked)) {
        result.toAutoHide.push(c);
        continue;
      }
      if (answered) result.toResolve.push(c);
      else result.toQueue.push(c);
    }
  }
  return result;
}

/** First-run backlog window (SPEC Section 8): default 90 days, configurable. */
export function backlogCutoff(now: Date, days = 90): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Threads whose inline replies are truncated (YouTube inlines at most 5). */
export function threadsNeedingFullReplies(threads: RawCommentThread[]): RawCommentThread[] {
  return threads.filter((t) => t.totalReplyCount > t.replies.length);
}

const ZERO_WIDTH = /[​-‍⁠﻿ \s]/g;

/**
 * Hidden link injection (SPEC Section 5, spam signature 2): anchors in the
 * rendered comment HTML that point at a channel but show no visible text, or
 * show text that is not an @mention. YouTube's own timestamp links
 * (watch?v=...&t=) and normal @mentions are ignored.
 */
export function detectHiddenLinks(html: string | null | undefined): string[] {
  if (!html) return [];
  const signals: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").replace(ZERO_WIDTH, "");
    const isTimestamp = /[?&]t=\d+/.test(href) || /^\d{1,2}(:\d{2}){1,2}$/.test(text);
    if (isTimestamp) continue;
    const pointsAtChannel = /youtube\.com\/(channel\/|@|c\/|user\/)/i.test(href);
    if (text.length === 0) {
      signals.push(`empty link to ${href || "(no href)"}`);
    } else if (pointsAtChannel && !text.startsWith("@")) {
      signals.push(`link text "${text.slice(0, 40)}" hides a link to ${href}`);
    }
  }
  // Malformed anchors with no closing tag or no href.
  if (/<a\b(?![^>]*href)[^>]*>/i.test(html)) signals.push("anchor tag with no href");
  return signals;
}

/**
 * Thread context for the categorizer: the top comment and nearby replies, so
 * a reply-shaped testimonial is judged as part of its cluster (SPEC Section 5,
 * spam signature 1) and a reply is read in conversation.
 */
export function buildThreadContext(
  targetId: string,
  threadComments: { id: string; author: string | null; text: string; isTop: boolean }[],
  maxItems = 6,
): string | undefined {
  const others = threadComments.filter((c) => c.id !== targetId);
  if (others.length === 0) return undefined;
  const top = others.find((c) => c.isTop);
  const rest = others.filter((c) => !c.isTop).slice(0, maxItems - (top ? 1 : 0));
  const line = (c: { author: string | null; text: string }, label: string) =>
    `${label} ${c.author ?? "viewer"}: ${c.text.replace(/\s+/g, " ").slice(0, 300)}`;
  return [top ? line(top, "[top comment]") : null, ...rest.map((c) => line(c, "[reply]"))]
    .filter(Boolean)
    .join("\n");
}
