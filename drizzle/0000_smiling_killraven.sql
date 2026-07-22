CREATE TYPE "public"."blocked_reason" AS ENUM('single_attack', 'accumulated_pattern');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('respond', 'ignore', 'delete_troll', 'delete_spam', 'flag_political');--> statement-breakpoint
CREATE TYPE "public"."draft_voice" AS ENUM('josh', 'jeb', 'house');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type" AS ENUM('loan', 'real_estate', 'none');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('youtube', 'instagram', 'tiktok', 'facebook');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'edited', 'rejected', 'posted', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"comment_review_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"performed_by" text,
	"performed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"channel_url" text,
	"display_name" text,
	"offense_count" integer DEFAULT 0 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_by" text,
	"blocked_reason" "blocked_reason",
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_flagged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "platform" DEFAULT 'youtube' NOT NULL,
	"platform_channel_id" text NOT NULL,
	"display_name" text NOT NULL,
	"oauth_refresh_token" text,
	"connected_by" text,
	"connected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"comment_id" integer NOT NULL,
	"category" "category",
	"confidence_score" double precision,
	"draft_reply_text" text,
	"draft_voice" "draft_voice",
	"opportunity_type" "opportunity_type" DEFAULT 'none',
	"opportunity_score" double precision DEFAULT 0,
	"notified_at" timestamp with time zone,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"action_taken_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"video_id" text NOT NULL,
	"video_title" text,
	"platform_comment_id" text NOT NULL,
	"author" text,
	"author_channel_url" text,
	"text" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"parent_comment_id" text,
	"fetched_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"channel_access" integer[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_log" ADD CONSTRAINT "action_log_comment_review_id_comment_reviews_id_fk" FOREIGN KEY ("comment_review_id") REFERENCES "public"."comment_reviews"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authors" ADD CONSTRAINT "authors_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comment_reviews" ADD CONSTRAINT "comment_reviews_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comments" ADD CONSTRAINT "comments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "authors_channel_url_idx" ON "authors" USING btree ("channel_id","channel_url");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_platform_channel_idx" ON "channels" USING btree ("platform","platform_channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reviews_status_idx" ON "comment_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reviews_category_idx" ON "comment_reviews" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comments_platform_comment_idx" ON "comments" USING btree ("platform_comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_channel_video_idx" ON "comments" USING btree ("channel_id","video_id");