// Author offense accrual and block eligibility (SPEC Section 5 blocking policy).
// Pure so the policy is unit-tested; moderation.ts applies it to the DB.
//
// Policy (per Josh): mutual respect, not benefit-of-the-doubt for hostility.
//   - Unambiguous attack on the hosts or brand (delete_troll, high
//     confidence): hide and block on the first instance.
//   - Hostile but ambiguous (lower confidence): hide the comment, hold the
//     block, accrue offenses, and surface the author for one-click blocking
//     once they reach BLOCK_SURFACE_OFFENSES.
// Blocking itself always stays a human click. Only the per-comment hide of a
// comment from an already-blocked author is automatic (on ingestion).

import type { Category } from "./domain";

/** delete_troll confidence at or above this is an unambiguous attack. */
export const UNAMBIGUOUS_TROLL_CONFIDENCE = 0.85;

/** Offenses (troll or spam hides) at which an author is surfaced for blocking. SPEC says 2 to 3. */
export const BLOCK_SURFACE_OFFENSES = 2;

export type BlockReason = "single_attack" | "accumulated_pattern";

export type BlockEligibility =
  | { eligible: true; reason: BlockReason }
  | { eligible: false; reason: null };

/**
 * Should the "hide and block author" option be offered for this comment?
 * `priorOffenses` is the author's offense count BEFORE this comment is acted on.
 */
export function blockEligibility(input: {
  category: Category | null;
  confidence: number;
  priorOffenses: number;
  alreadyBlocked?: boolean;
}): BlockEligibility {
  const { category, confidence, priorOffenses, alreadyBlocked } = input;
  if (alreadyBlocked) return { eligible: false, reason: null };
  if (category !== "delete_troll" && category !== "delete_spam") return { eligible: false, reason: null };
  if (category === "delete_troll" && confidence >= UNAMBIGUOUS_TROLL_CONFIDENCE) {
    return { eligible: true, reason: "single_attack" };
  }
  // Counting this comment, has the author reached the surfacing threshold?
  if (priorOffenses + 1 >= BLOCK_SURFACE_OFFENSES) {
    return { eligible: true, reason: "accumulated_pattern" };
  }
  return { eligible: false, reason: null };
}

/** Authors already at the threshold and not blocked: the repeat-offender list. */
export function shouldSurfaceForBlock(author: { offenseCount: number; blocked: boolean }): boolean {
  return !author.blocked && author.offenseCount >= BLOCK_SURFACE_OFFENSES;
}

export type OffenseEvent = "hide" | "restore";

/** Next offense count after a hide (one more) or a restore (one fewer, floor 0). */
export function accrueOffense(current: number, event: OffenseEvent): number {
  return event === "hide" ? current + 1 : Math.max(0, current - 1);
}
