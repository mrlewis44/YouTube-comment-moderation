# Comment Copilot

YouTube comment triage and response-drafting tool for The Educated HomeBuyer and
Josh Lewis's personal channel. Polls both channels, categorizes comments with
Claude (respond / ignore / delete_troll / delete_spam / flag_political), drafts
replies in the TEHB voice, and routes everything through a human-approval queue
before anything posts or hides.

**Spec:** [`SPEC.md`](./SPEC.md) is the build spec and the source of truth. It
covers auth, data model, the categorization taxonomy, voice rules for reply
drafting, staged autonomy for spam auto-actioning, the MVP feature list, and the
open items to confirm before launch.

## Status

The MVP is built. It is not live yet: production still runs the earlier
scaffold, and neither YouTube channel has been authorized (see the go-live
checklist below).

### Built and working

- **Login and access.** NextAuth (Auth.js v5) Google login gated by
  `ALLOWED_EMAILS`, with roles and per-channel access (Josh: both channels and
  admin, Jeb: TEHB only).
- **Channel connection** at `/connect` (admin). The refresh token is stored
  AES-256-GCM encrypted. The callback checks that the Google account that
  consented actually owns the channel (for TEHB, the brand account) and refuses
  a mismatch, since a wrong-account token can read comments but cannot reply or
  hide.
- **Connection health** at the top of the queue, per channel: token connected
  or not, last successful sync, comments pulled (seen and new), comments waiting
  for triage, unanswered question count, and the last error in plain English.
  A refresh-token failure (`invalid_grant`) marks the channel "Needs reconnect"
  and tells Josh to reconnect at `/connect` and to check the OAuth consent
  screen publishing status (Testing mode expires tokens after 7 days).
- **Ingestion** (`src/lib/ingest.ts`, rules in `src/lib/ingest-core.ts`):
  - Pulls the 90-day backlog on every sync (about 1 quota unit per 100
    threads), fetching full reply lists for threads YouTube truncates to 5.
  - Stores every new viewer comment at once. Comments a host already answered
    are stored as resolved and never sent to Claude. Host replies are matched
    by YouTube channel id (either in-scope channel counts, plus optional
    `HOST_CHANNEL_IDS`), and a viewer reply posted after the host's answer still
    counts as unanswered.
  - Pending comments resolve automatically once a host answers them on YouTube.
  - Comments from blocked authors are hidden before categorization.
  - Claude triage then runs newest first inside the request's time budget.
    "Sync now" keeps running triage rounds until the backlog is categorized.
  - Every sync writes a `sync_runs` row; the daily cron also logs a summary
    line to Vercel's runtime logs.
  - In production a channel without a token reports "not connected". Sample
    data is local-development only and can no longer reach the live database
    (the earlier scaffold fell back to sample threads; any such leftover rows
    are purged on the first real sync).
- **Review queue, wired live** (`/api/review/action`, `src/lib/moderation.ts`).
  Every button is a human click and is written to `action_log`:
  - Approve and post (edits included, em dashes converted on post). Replies to
    a reply post into the same thread, addressed to the author.
  - Political comments: no AI draft ever; a human can write and post their own
    reply, or dismiss.
  - Hide (troll or spam) uses a reversible hide (see "Verified during build").
  - Remove and block author when block-eligible: an unambiguous attack
    (troll confidence 0.85 or higher) on the first instance, or any author at 2
    or more hidden comments. Uses YouTube's `banAuthor` plus our own `blocked`
    flag.
  - Not spam / Dismiss / Mark reviewed.
  - A short claim on each item stops two reviewers (or a double click) from
    posting twice.
- **Unanswered backlog first.** The default "Needs a reply" view leads with
  possible leads (opportunity score 0.6 or higher, by score), then questions,
  then other `respond` comments, newest first within each group, then
  political. The categorizer now returns `isQuestion`, with a heuristic
  fallback for older rows. Unanswered question counts show per channel.
- **Authors tab.** Offense accrual on every hide (minus one on restore),
  repeat offenders listed for one-click blocking, blocked list with unblock.
- **Spam autopilot (SPEC Section 7)** on the Auto-actioned tab. Graduates once
  25 human-reviewed spam decisions are confirmed with none overturned, across at
  least two signatures (`trading_testimonial`, `hidden_link`), over at least 7
  days. "Not spam" or restoring a hidden comment is an overturn and restarts
  the count. Once graduated, only confident matches (0.85 or higher) of the two
  known signatures are auto-hidden, with the reversible hide. Every auto-action
  is listed under "Recently auto-actioned" with a Restore button. Admin can
  pause it. Graduation is evaluated across both channels combined.
- **Prompts** follow SPEC Sections 5 and 6: two-host voice by topic lens (never
  blended; personal channel always Josh), no em dashes (also stripped in code),
  named sources for data, optional CTA with the offer ladder, political never
  drafted (the categorizer flags it, and the drafter refuses as a second
  check). The categorizer now gets thread context (to judge spam clusters as a
  unit) and hidden-link signals from the comment HTML.
- **Google Chat** high-priority opportunity pings (SPEC 8a), unchanged.

### Verified during build

- **Blocking is automatable.** `comments.setModerationStatus` with
  `moderationStatus=rejected&banAuthor=true` is YouTube's "hide user from
  channel". Undo it in YouTube Studio under Settings, Community, Hidden users.
- **`rejected` is not reversible.** Google's reference for
  `comments.setModerationStatus` says a rejected comment cannot be set back to
  `published`, which contradicts the assumption in SPEC Section 7. So the
  reversible hide is `heldForReview`: the comment leaves public view and sits in
  YouTube Studio's "Held for review" tab, and Restore publishes it again.
  `rejected` is used only for "Remove and block", where `banAuthor` requires it.
  Not verified live (this build environment cannot reach googleapis.com):
  confirm on the first real hide that the comment disappears publicly and
  shows under Held for review.
- **Quota.** Reads cost 1 unit per call, each reply or hide costs 50 (a hide
  can batch up to 50 comments). The default 10,000 units/day covers a daily
  sync plus roughly 150 to 190 manual actions.

### Not built yet

- Pulling YouTube's own "Held for review" and "Likely spam" queues
  (`moderationStatus=heldForReview|likelySpam`), SPEC Section 8 item 3.
- Phase 2 items: digest notification, bulk actions, cross-comment clustering.
- Polling every 10 to 15 minutes. The cron runs once a day (13:00 UTC) because
  the current Vercel plan only allows daily cron jobs. On a plan that allows
  it, change the schedule in `vercel.json` to `*/15 * * * *`. Sync now covers
  the gap.

## Go-live checklist (Josh)

1. **Database note.** Preview and production deployments share one Neon
   database (the Postgres env vars target both). The preview build of
   `claude/copilot-go-live` applies migration `0001` to the
   production database. It is additive only (new tables, new nullable or
   defaulted columns, two new status values, a thread id backfill), and the
   currently deployed code keeps working against it.
2. **Review the preview.** Check the build on the `claude/copilot-go-live`
   preview. Do not connect channels or click queue actions on the preview:
   `NEXTAUTH_URL` points at production, and anything you do there writes to the
   shared production database.
3. **Merge to go live.** Merge `claude/copilot-go-live` into
   `claude/comment-copilot-spec-9is46n` (the production branch). Vercel
   redeploys production; the build runs migrations and the seed.
4. **Google Cloud (project tehb-website).** The OAuth consent screen is already
   In production, which keeps refresh tokens from expiring after 7 days. Leave
   it there. Data Access lists no scopes, so Google will show a "Google hasn't
   verified this app" screen when you connect; as the project owner click
   Advanced, then continue. To remove the warning, add
   `https://www.googleapis.com/auth/youtube.force-ssl` under Google Auth
   Platform, Data Access (it is a sensitive scope; unverified apps are capped
   at 100 users, which is fine here). The YouTube Data API is already enabled
   in the project.
5. **Connect both channels** at `/connect` on the production URL, after the
   merge. For The Educated HomeBuyer pick the brand account in Google's
   account picker; for Josh Lewis pick the personal channel's account. The app
   refuses a mismatch.
6. **Sync now.** Click Sync now and let it run until "still to triage" reaches
   zero (it loops automatically; Stop is safe, the rest continues on the next
   sync). Confirm each channel's health card shows "Connected and syncing"
   with a comment count.
7. **First real actions.** Post one reply and hide one spam comment, then
   check on YouTube that the reply is live and the hidden comment is gone from
   public view and listed under Studio's Held for review.
8. **Optional.** Test the Google Chat webhook with `POST /api/notify-test`.
   Set `HOST_CHANNEL_IDS` if Jeb answers from his own channel. Set
   `ANTHROPIC_MODEL` if the default model id is rejected (the health card says
   so in plain English).

## Local development

```
cp .env.example .env.local   # fill in secrets (SPEC Section 9)
pnpm install
pnpm dev
```

In development, a channel without a token uses sample YouTube data, so the
whole pipeline runs without Google credentials (`COPILOT_MOCK_YOUTUBE=0` turns
that off). Without a database the queue renders the sample comments in
`src/lib/mock.ts`. Sign-in and the Claude routes need their env vars.

```
pnpm test        # unit tests for the pure rules (node:test via tsx)
pnpm typecheck
pnpm build
pnpm db:generate # after any schema change; migrations run on deploy
```
