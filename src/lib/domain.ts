// Core domain constants and types for Comment Copilot.
// Source of truth is SPEC.md. Keep this file in sync with Sections 2, 4, 5, 6.

/** The two YouTube channels in scope (SPEC Section 1). */
export const CHANNELS = {
  tehb: {
    key: "tehb",
    platform: "youtube",
    platformChannelId: "UCbArQYdfPC2Dimq0LymXPYg",
    handle: "@theeducatedhomebuyer",
    displayName: "The Educated HomeBuyer",
  },
  josh: {
    key: "josh",
    platform: "youtube",
    platformChannelId: "UCvb_RkYOhXfCzeKLkCSEPTA",
    handle: "@joshlewisCMC",
    displayName: "Josh Lewis",
  },
} as const;

export type ChannelKey = keyof typeof CHANNELS;

/** Categorization taxonomy (SPEC Section 5). */
export const CATEGORIES = [
  "respond",
  "ignore",
  "delete_troll",
  "delete_spam",
  "flag_political",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  respond: "Respond",
  ignore: "Ignore",
  delete_troll: "Delete (troll)",
  delete_spam: "Delete (spam)",
  flag_political: "Flag (political)",
};

/**
 * Which host register a draft reply is written in (SPEC Section 6).
 * This is a drafting/expertise signal, NOT a reviewer gate. TEHB replies post
 * unsigned as the channel, so either host can approve any draft regardless of
 * its voice.
 */
export const DRAFT_VOICES = ["josh", "jeb", "house"] as const;
export type DraftVoice = (typeof DRAFT_VOICES)[number];

/** Review lifecycle status (SPEC Section 4). */
export const REVIEW_STATUSES = [
  "pending",
  "approved",
  "edited",
  "rejected",
  "posted",
  "deleted",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** App roles (SPEC Section 2). */
export type Role = "admin" | "member";

/**
 * Categories whose action deletes/hides a public comment. Per SPEC Section 7,
 * only delete_spam can graduate to auto-run; everything else stays human-gated.
 */
export const DELETE_CATEGORIES: Category[] = ["delete_troll", "delete_spam"];

/** flag_political never gets an auto-postable reply and never graduates (SPEC 5, 7). */
export function isAutoReplyBlocked(category: Category): boolean {
  return category === "flag_political";
}

/**
 * Opportunity signal (SPEC Section 8a). Cross-cutting on top of the category:
 * does this comment look like a potential client, someone with buying,
 * refinancing, or listing intent worth a fast personal reach-out? Routed to
 * Google Chat as a high-priority ping so it does not wait for the next review.
 */
export const OPPORTUNITY_TYPES = ["loan", "real_estate", "none"] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_LABELS: Record<OpportunityType, string> = {
  loan: "Loan opportunity",
  real_estate: "Real estate opportunity",
  none: "No opportunity",
};

/** Score at or above this fires a Google Chat notification (SPEC Section 8a). */
export const OPPORTUNITY_NOTIFY_THRESHOLD = 0.6;

export function isNotifiableOpportunity(
  type: OpportunityType,
  score: number,
): boolean {
  return type !== "none" && score >= OPPORTUNITY_NOTIFY_THRESHOLD;
}
