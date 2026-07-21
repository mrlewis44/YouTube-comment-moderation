// Pure ingestion logic (no DB, no network) so the tricky rules from SPEC
// Section 8 (item 3) are unit-testable in isolation:
//   - flatten threads into individual comments
//   - dedup against already-stored comment ids
//   - mark threads already answered by the channel as resolved, not re-queued
//   - auto-drop comments from blocked authors before they reach the queue
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

/**
 * A thread is already handled if the channel's own authenticated account has
 * replied in it (SPEC Section 8, dedup on ingestion). We detect this by author
 * channel url matching the owner's, on any comment in the thread.
 */
export function threadHasHostReply(
  thread: RawCommentThread,
  ownerChannelUrls: string[],
): boolean {
  const owners = new Set(ownerChannelUrls.filter(Boolean));
  const all = [thread.topComment, ...thread.replies];
  return all.some((c) => c.authorChannelUrl && owners.has(c.authorChannelUrl));
}

export type PartitionInput = {
  threads: RawCommentThread[];
  existingCommentIds: Set<string>;
  blockedAuthorUrls: Set<string>;
  ownerChannelUrls: string[];
};

export type PartitionResult = {
  // New comments to categorize and queue.
  toQueue: NormalizedComment[];
  // Comments from blocked authors: auto-delete before they reach the queue
  // (SPEC Section 5 blocking policy).
  toAutoDelete: NormalizedComment[];
  // Thread ids already answered by a host: store as resolved, do not re-queue.
  resolvedThreadIds: string[];
  // Already-stored comment ids we skipped.
  skippedDuplicates: number;
};

export function partitionForIngest(input: PartitionInput): PartitionResult {
  const { threads, existingCommentIds, blockedAuthorUrls, ownerChannelUrls } = input;
  const resolvedThreadIds: string[] = [];
  const toQueue: NormalizedComment[] = [];
  const toAutoDelete: NormalizedComment[] = [];
  let skippedDuplicates = 0;

  for (const thread of threads) {
    const answered = threadHasHostReply(thread, ownerChannelUrls);
    if (answered) resolvedThreadIds.push(thread.threadId);

    for (const c of flattenThreads([thread])) {
      if (existingCommentIds.has(c.id)) {
        skippedDuplicates++;
        continue;
      }
      // Never queue the host's own comments.
      if (c.authorChannelUrl && ownerChannelUrls.includes(c.authorChannelUrl)) continue;

      if (c.authorChannelUrl && blockedAuthorUrls.has(c.authorChannelUrl)) {
        toAutoDelete.push(c);
        continue;
      }
      if (answered) continue; // resolved thread: recorded, not queued
      toQueue.push(c);
    }
  }

  return { toQueue, toAutoDelete, resolvedThreadIds, skippedDuplicates };
}

/** First-run backlog window (SPEC Section 8): default 90 days, configurable. */
export function backlogCutoff(now: Date, days = 90): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
