// Author offense accrual and block state in the authors table (SPEC Section 5).
// Our own `blocked` flag is the source of truth: comments from a blocked
// author are hidden on ingestion before they reach categorization. YouTube's
// own ban (setModerationStatus rejected + banAuthor) is applied too when the
// block is clicked, so YouTube also rejects their future comments.

import { and, eq } from "drizzle-orm";
import { db, authors, type Author } from "@/db";
import { accrueOffense, type BlockReason, type OffenseEvent } from "./moderation-rules";

export type AuthorRef = {
  channelId: number;
  platformAuthorId: string | null;
  channelUrl: string | null;
  displayName: string | null;
};

export async function findAuthor(ref: AuthorRef): Promise<Author | null> {
  if (ref.platformAuthorId) {
    const [row] = await db
      .select()
      .from(authors)
      .where(and(eq(authors.channelId, ref.channelId), eq(authors.platformAuthorId, ref.platformAuthorId)));
    if (row) return row;
  }
  if (ref.channelUrl) {
    const [row] = await db
      .select()
      .from(authors)
      .where(and(eq(authors.channelId, ref.channelId), eq(authors.channelUrl, ref.channelUrl)));
    if (row) return row;
  }
  return null;
}

/**
 * Record a hide (offense +1) or a restore (offense -1) against an author,
 * creating the author row on first offense. Optionally blocks in the same write.
 */
export async function recordOffense(
  ref: AuthorRef,
  event: OffenseEvent,
  opts: { commentId?: string; block?: { by: string; reason: BlockReason } } = {},
): Promise<Author | null> {
  const existing = await findAuthor(ref);
  if (!existing && event === "restore") return null;
  const now = new Date();
  const blockFields = opts.block
    ? { blocked: true, blockedAt: now, blockedBy: opts.block.by, blockedReason: opts.block.reason }
    : {};

  if (existing) {
    const [row] = await db
      .update(authors)
      .set({
        offenseCount: accrueOffense(existing.offenseCount, event),
        ...(event === "hide" ? { lastFlaggedAt: now } : {}),
        ...(opts.commentId ? { lastCommentId: opts.commentId } : {}),
        ...(ref.platformAuthorId && !existing.platformAuthorId ? { platformAuthorId: ref.platformAuthorId } : {}),
        ...(ref.displayName ? { displayName: ref.displayName } : {}),
        ...blockFields,
      })
      .where(eq(authors.id, existing.id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(authors)
    .values({
      channelId: ref.channelId,
      platformAuthorId: ref.platformAuthorId,
      channelUrl: ref.channelUrl,
      displayName: ref.displayName,
      offenseCount: accrueOffense(0, event),
      lastFlaggedAt: now,
      lastCommentId: opts.commentId ?? null,
      ...blockFields,
    })
    .returning();
  return row;
}

export async function setAuthorBlocked(
  authorId: number,
  blocked: boolean,
  by: string,
  reason: BlockReason | null,
): Promise<Author | null> {
  const [row] = await db
    .update(authors)
    .set(
      blocked
        ? { blocked: true, blockedAt: new Date(), blockedBy: by, blockedReason: reason }
        : { blocked: false, blockedAt: null, blockedBy: null, blockedReason: null },
    )
    .where(eq(authors.id, authorId))
    .returning();
  return row ?? null;
}
