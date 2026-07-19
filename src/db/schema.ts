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

export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "approved",
  "edited",
  "rejected",
  "posted",
  "deleted",
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
  displayName: text("display_name"),
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
  text: text("text").notNull(),
  likeCount: integer("like_count").notNull().default(0),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // Nullable: set when this comment is a reply within a thread (SPEC Section 4).
  parentCommentId: text("parent_comment_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
}, (t) => ({
  platformCommentIdx: uniqueIndex("comments_platform_comment_idx").on(
    t.platformCommentId,
  ),
  channelVideoIdx: index("comments_channel_video_idx").on(t.channelId, t.videoId),
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
  status: reviewStatusEnum("status").notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  actionTakenAt: timestamp("action_taken_at", { withTimezone: true }),
}, (t) => ({
  statusIdx: index("comment_reviews_status_idx").on(t.status),
  categoryIdx: index("comment_reviews_category_idx").on(t.category),
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
});

export type Channel = typeof channels.$inferSelect;
export type User = typeof users.$inferSelect;
export type Author = typeof authors.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentReview = typeof commentReviews.$inferSelect;
export type ActionLogEntry = typeof actionLog.$inferSelect;
