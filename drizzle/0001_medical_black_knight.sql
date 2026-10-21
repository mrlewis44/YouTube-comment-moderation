ALTER TYPE "public"."review_status" ADD VALUE 'resolved';--> statement-breakpoint
ALTER TYPE "public"."review_status" ADD VALUE 'restored';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"phase" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean DEFAULT false NOT NULL,
	"threads_fetched" integer DEFAULT 0 NOT NULL,
	"comments_fetched" integer DEFAULT 0 NOT NULL,
	"new_comments" integer DEFAULT 0 NOT NULL,
	"triaged" integer DEFAULT 0 NOT NULL,
	"auto_hidden" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"remaining" integer DEFAULT 0 NOT NULL,
	"error_kind" text,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "platform_author_id" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "last_comment_id" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "token_error" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "token_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "spam_signature" text;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "is_question" boolean;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "overturned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "auto_actioned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "posted_text" text;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "posted_reply_id" text;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "triage_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reviews" ADD COLUMN "triage_error" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "author_channel_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "text_html" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "thread_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_runs_channel_started_idx" ON "sync_runs" USING btree ("channel_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "authors_channel_platform_author_idx" ON "authors" USING btree ("channel_id","platform_author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reviews_comment_idx" ON "comment_reviews" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_thread_idx" ON "comments" USING btree ("thread_id");--> statement-breakpoint
-- Backfill thread ids for comments stored before 0001. On YouTube the thread id
-- equals the top-level comment id, and a reply's parent id is that thread id.
UPDATE "comments" SET "thread_id" = COALESCE("parent_comment_id", "platform_comment_id") WHERE "thread_id" IS NULL;