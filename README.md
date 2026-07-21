# Comment Copilot

YouTube comment triage and response-drafting tool for The Educated HomeBuyer and
Josh Lewis's personal channel. Polls both channels, categorizes comments with
Claude (respond / ignore / delete_troll / delete_spam / flag_political), drafts
replies in the TEHB voice, and routes everything through a human-approval queue
before anything posts or deletes.

**Spec:** [`SPEC.md`](./SPEC.md) is the build spec and the source of truth. It
covers auth, data model, the categorization taxonomy, voice rules for reply
drafting, staged autonomy for spam auto-actioning, the MVP feature list, and the
open items to confirm before launch.

## Status

The foundation is scaffolded. Live YouTube ingestion and posting are not wired
yet, they are gated on the credentials and decisions in SPEC Sections 3, 9, 11.

Built and working:

- Next.js (App Router) on the Vercel stack, TypeScript, Tailwind with the TEHB
  warm editorial tokens.
- NextAuth (Auth.js v5) Google login gated by the `ALLOWED_EMAILS` allowlist,
  with role and per-channel access (Josh: both channels, Jeb: TEHB only).
- Drizzle schema for Vercel Postgres matching SPEC Section 4, plus an idempotent
  seed for channels and users.
- Server-side Claude routes `/api/categorize` and `/api/draft-reply` holding the
  API key, with the taxonomy (Section 5) and voice rules (Section 6) in the
  prompts, and a hard em-dash strip on every draft.
- Review-queue UI running on sample comments: filter by channel and category,
  edit drafts inline, and per-category actions that follow the staged-autonomy
  and blocking rules (confidence-branched blocking, reversible spam hide,
  no auto-reply on political).

- YouTube OAuth connection flow: per-channel authorize at `/connect` (admin),
  refresh token stored AES-256-GCM encrypted (`src/lib/crypto.ts`).
- Ingestion pipeline: `/api/cron/ingest` (Vercel Cron every 15 min, `CRON_SECRET`
  gated) pulls threads, applies the dedup / host-reply-resolution / blocked-author
  rules (`src/lib/ingest-core.ts`, unit-tested), then persists, categorizes,
  drafts `respond` replies, and fires opportunity pings. Reads fall back to mock
  data until a channel token exists, so the pipeline runs before go-live.
- YouTube client (`src/lib/youtube.ts`) with reversible spam hide via
  `setModerationStatus(rejected)` per SPEC Section 7.

Not yet built (needs the Section 11 items resolved and credentials in place):

- Wiring the review-queue buttons to the live post/hide calls + action log
  (the write client and schema are ready; the queue still runs on mock actions).
- Author offense accrual and one-click blocking against the live DB.
- Staged-autonomy graduation tracking for `delete_spam` (SPEC Section 7).
- Vercel deploy (project + env + cron are configured in `vercel.json`).

## Local development

```
cp .env.example .env.local   # fill in secrets (SPEC Section 9)
pnpm install
pnpm dev
```

Without a database or Google credentials the review queue still renders on the
sample comments in `src/lib/mock.ts` so the workflow can be reviewed. Sign-in and
the Claude routes need their respective env vars.

`pnpm typecheck` and `pnpm build` both pass.
