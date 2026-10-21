// Drizzle schema for Comment Copilot (Vercel Postgres).
// Mirrors SPEC.md Section 4. The `channels` and `authors` tables are
// deliberately platform-agnostic so future platforms are additive (Section 10).

import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  doublePrecision,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", [
  "youtube",
  "instagram",
  "tiktok",
  "facebook",
]);

export const roleEnum = pgEnum("role", ["admin", "member"]);

export const categoryEnum = pgEnum("category", [
  "respond",
  "ignore",
  "delete_troll",
  "delete_spam",
  "flag_political",
]);

export const draftVoiceEnum = pgEnum("draft_voice", ["josh", "jeb", "house"]);

export const opportunityTypeEnum = pgEnum("opportunity_type", [
  "loan",
  "real_estate",
  "none",
]);

export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "approved",
  "edited",
  "rejected",
  "posted",
  "deleted",
  // Added in 0001. resolved: a host already answered the thread (on YouTube or
  // through the app), so it no longer needs action. restored: a hidden comment
  // was put back on public view (an overturned moderation decision).
  "resolved",
  "restored",
]);

export const blockedReasonEnum = pgEnum("blocked_reason", [
  "single_attack",
  "accumulated_pattern",
]);

// Only `youtube` is populated in this build; the column exists now so future
// platforms are additive rather than a schema migration (SPEC Section 10).
export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  platform: platformEnum("platform").notNull().default("youtube"),
  platformChannelId: text("platform_channel_id").notNull(),
  displayName: text("display_name").notNull(),
  // Encrypted at the application layer before it ever touches the row.
  // Never sent to the browser (SPEC Section 3, secrets handling).
  oauthRefreshToken: text("oauth_refresh_token"),
  connectedBy: text("connected_by"),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  // Set when Google refuses the stored refresh token (invalid_grant). Cleared
  // on the next successful token refresh or reconnect. Drives the "reconnect"
  // banner in the connection-health panel.
  tokenError: text("token_error"),
  tokenErrorAt: timestamp("token_error_at", { withTimezone: true }),
}, (t) => ({
  platformChannelIdx: uniqueIndex("channels_platform_channel_idx").on(
    t.platform,
    t.platformChannelId,
  ),
}));

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("member"),
  // Array of channel ids this user may review. Josh: both, Jeb: TEHB only.
  channelAccess: integer("channel_access").array().notNull().default([]),
});

export const authors = pgTable("authors", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id),
  channelUrl: text("channel_url"),
  // YouTube author channel id (snippet.authorChannelId.value). The stable key
  // for an author; display names and URLs can change.
  platformAuthorId: text("platform_author_id"),
  displayName: text("display_name"),
  // Most recent comment id we took action on. Needed to block from the
  // authors panel: YouTube's ban is applied through a comment
  // (setModerationStatus rejected + banAuthor).
  lastCommentId: text("last_comment_id"),
  // Troll/spam actions taken against this author (SPEC Section 5 blocking policy).
  offenseCount: integer("offense_count").notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  blockedBy: text("blocked_by"),
  blockedReason: blockedReasonEnum("blocked_reason"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow(),
  lastFlaggedAt: timestamp("last_flagged_at", { withTimezone: true }),
}, (t) => ({
  channelUrlIdx: index("authors_channel_url_idx").on(t.channelId, t.channelUrl),
  platformAuthorIdx: uniqueIndex("authors_channel_platform_author_idx").on(
    t.channelId,
    t.platformAuthorId,
  ),
}));

export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id),
  videoId: text("video_id").notNull(),
  videoTitle: text("video_title"),
  platformCommentId: text("platform_comment_id").notNull(),
  author: text("author"),
  authorChannelUrl: text("author_channel_url"),
  // YouTube author channel id; used for host-reply detection and author tracking.
  authorChannelId: text("author_channel_id"),
  text: text("text").notNull(),
  // YouTube textDisplay (HTML). Kept because hidden link injection (SPEC 5,
  // spam signature 2) only shows up as anchors in the rendered HTML.
  textHtml: text("text_html"),
  likeCount: integer("like_count").notNull().default(0),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // Nullable: set when this comment is a reply within a thread (SPEC Section 4).
  parentCommentId: text("parent_comment_id"),
  // Thread id (equals the top-level comment id on YouTube).
  threadId: text("thread_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  platformCommentIdx: uniqueIndex("comments_platform_comment_idx").on(
    t.platformCommentId,
  ),
  channelVideoIdx: index("comments_channel_video_idx").on(t.channelId, t.videoId),
  threadIdx: index("comments_thread_idx").on(t.threadId),
}));

export const commentReviews = pgTable("comment_reviews", {
  id: serial("id").primaryKey(),
  commentId: integer("comment_id")
    .notNull()
    .references(() => comments.id),
  category: categoryEnum("category"),
  confidenceScore: doublePrecision("confidence_score"),
  draftReplyText: text("draft_reply_text"),
  // Drafting/expertise signal, not a reviewer gate (SPEC Section 6).
  draftVoice: draftVoiceEnum("draft_voice"),
  // Opportunity signal (SPEC Section 8a). Drives the Google Chat hot-lead ping.
  opportunityType: opportunityTypeEnum("opportunity_type").default("none"),
  opportunityScore: doublePrecision("opportunity_score").default(0),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  status: reviewStatusEnum("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  actionTakenAt: timestamp("action_taken_at", { withTimezone: true }),
  // Which delete_spam signature the categorizer matched (SPEC 5, 7):
  // trading_testimonial | hidden_link | other. Drives the "two distinct
  // signatures" graduation rule.
  spamSignature: text("spam_signature"),
  // Categorizer's read on whether the comment asks something (backlog sort).
  isQuestion: boolean("is_question"),
  // True when a human reversed this decision: a flagged spam comment marked
  // "not spam", or a hidden comment restored. Resets spam graduation (SPEC 7).
  overturned: boolean("overturned").notNull().default(false),
  // True when the system acted without a human (graduated spam auto-hide,
  // blocked-author auto-hide). Powers the "recently auto-actioned" view.
  autoActioned: boolean("auto_actioned").notNull().default(false),
  // Short-lived claim so two people (or the cron and a manual sync) never act
  // on the same comment at once, which would double-post a reply.
  claimedBy: text("claimed_by"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  // What actually went out, and the YouTube id of the posted reply.
  postedText: text("posted_text"),
  postedReplyId: text("posted_reply_id"),
  // Triage bookkeeping: a review with category null is waiting for Claude.
  triageAttempts: integer("triage_attempts").notNull().default(0),
  triageError: text("triage_error"),
}, (t) => ({
  statusIdx: index("comment_reviews_status_idx").on(t.status),
  categoryIdx: index("comment_reviews_category_idx").on(t.category),
  commentIdx: index("comment_reviews_comment_idx").on(t.commentId),
}));

// Full audit trail of every post/delete/dismiss (SPEC Section 4).
export const actionLog = pgTable("action_log", {
  id: serial("id").primaryKey(),
  commentReviewId: integer("comment_review_id")
    .notNull()
    .references(() => commentReviews.id),
  actionType: text("action_type").notNull(),
  performedBy: text("performed_by"),
  performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow(),
  // Structured context: posted reply id, edited flag, hide method, errors.
  detail: jsonb("detail"),
});

// One row per channel per sync call (cron or "Sync now"). Powers the
// connection-health panel: last successful sync, comments pulled, last error.
export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id")
    .notNull()
    .references(() => channels.id),
  trigger: text("trigger").notNull(), // cron | manual
  phase: text("phase").notNull(), // full (fetch + triage) | triage
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ok: boolean("ok").notNull().default(false),
  threadsFetched: integer("threads_fetched").notNull().default(0),
  commentsFetched: integer("comments_fetched").notNull().default(0),
  newComments: integer("new_comments").notNull().default(0),
  triaged: integer("triaged").notNull().default(0),
  autoHidden: integer("auto_hidden").notNull().default(0),
  resolved: integer("resolved").notNull().default(0),
  remaining: integer("remaining").notNull().default(0),
  errorKind: text("error_kind"),
  errorMessage: text("error_message"),
}, (t) => ({
  channelStartedIdx: index("sync_runs_channel_started_idx").on(t.channelId, t.startedAt),
}));

// Small key/value store for app-wide switches (spam autopilot pause).
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type Channel = typeof channels.$inferSelect;
export type User = typeof users.$inferSelect;
export type Author = typeof authors.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentReview = typeof commentReviews.$inferSelect;
export type ActionLogEntry = typeof actionLog.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
