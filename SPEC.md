# Comment Copilot, Build Spec

**For:** Josh Lewis, BuyWise Mortgage / The Educated HomeBuyer
**Purpose:** Automate triage and response drafting for YouTube comments across two channels, with a human-approval queue before anything posts or deletes.
**Delivery:** Next.js app on Vercel, extending the existing tehb-website Google Cloud OAuth client.

> Voice grounding: reply-drafting rules in Section 6 are calibrated against the
> TEHB editorial docs in the tehb-website repo. Both host voice-analysis docs are
> in scope, TEHB is a two-host show and replies come in two registers:
> `docs/voice/josh-voice-analysis.md` (mortgage/financing lens) and
> `docs/voice/jeb-voice-analysis.md` (real estate/agent, buying-process, local-market
> lens). The shared rules live in `docs/voice/anti-slop-SKILL.md` (Tier A pattern
> ban, em-dash rule), `docs/editorial/FACTS-CANON.md` (source-citation rule, offer
> ladder, Jeb-first host order), and `docs/editorial/EDITORIAL-SOP.md`. Those files
> are the source of truth. This spec does not restate them, it points to them.

---

## 1. Problem

Two YouTube channels are generating comment volume that isn't getting monitored:

- **The Educated HomeBuyer**, `@theeducatedhomebuyer`, channel ID `UCbArQYdfPC2Dimq0LymXPYg` (~10,700 subs)
- **Josh Lewis (personal)**, `@joshlewisCMC`, channel ID `UCvb_RkYOhXfCzeKLkCSEPTA` (~909 subs)

Questions go unanswered, engagement opportunities are missed, and spam/troll comments sit live on videos. This needs to be triaged and mostly automated, with humans staying in the loop on anything that posts publicly or deletes content.

---

## 2. Scope

- **Channels:** Both TEHB and the personal channel, as separate contexts within one app.
- **Users:**
  - Josh, admin, access to both channels
  - Jeb Smith, member, access to TEHB only
- **Auth model:** App-level login is separate from YouTube API authorization. Josh authorizes the YouTube API connection once per channel (OAuth consent as the channel-authorized account). Jeb logs into the app with his own Google account for review/approve access to the TEHB queue. He does **not** need his own YouTube moderator grant unless we later decide otherwise. Flag this assumption back if Jeb already has Manager-level access on the TEHB brand account and would rather connect directly.

---

## 3. Architecture

- **Framework:** Next.js (App Router), hosted on Vercel, same stack as tehb-website.
- **Auth:** NextAuth.js with Google provider. Reuse the existing OAuth client (Client ID `254769851278-2btqsppo10fdonfhlhgt8dugrf2rh8ml.apps.googleusercontent.com`) and add the `https://www.googleapis.com/auth/youtube.force-ssl` scope. If scope changes require a new consent screen review, flag it. Otherwise extend in place rather than creating a second OAuth client.
- **App login allowlist:** `ALLOWED_EMAILS` env var, following the same pattern as tehb-website's `ADMIN_EMAILS` (comma-separated, lowercased, trimmed, see `server/_core/env.ts` in tehb-website). Include josh@buywisemortgage.com and jeb@jebsmith.net at minimum.
- **Database:** Vercel Postgres (or Supabase if easier to provision) for comments, categorization state, queue status, action log, and repeat-offender tracking.
- **Secrets handling:** Google refresh tokens (the ones authorized to post/delete on each channel) live encrypted in the database, never in the browser. All YouTube write calls (reply, delete, mark-as-spam) happen server-side via Next.js API routes/server actions. The browser never holds a long-lived Google credential, only its own NextAuth session.
- **Anthropic API:** Called server-side from a Next.js API route holding `ANTHROPIC_API_KEY`, not from the browser. The browser calls our own `/api/categorize` and `/api/draft-reply` routes, which proxy to Claude. This deviates slightly from the pure-client-side pattern used in some earlier BuyWise tools. Comment moderation writes to a public channel, so the API key and the write path both need to stay server-side.
- **Model:** Claude Sonnet for categorization and drafting (cost-appropriate for high comment volume; escalate to Opus only if categorization accuracy needs it).

---

## 4. Data Model (starting point, adjust as needed)

- `channels`: id, **platform** (enum: youtube, instagram, tiktok, facebook, only `youtube` populated in this build), platform_channel_id, display_name, oauth_refresh_token (encrypted), connected_by, connected_at. Renamed from `youtube_channel_id` to `platform_channel_id` and added the `platform` column now, even though only YouTube ships here, so future platforms are additive rather than a schema migration. See Section 10.
- `users`: id, email, role (admin/member), channel_access (array)
- `comments`: id, channel_id, video_id, video_title, platform_comment_id, author, author_channel_url, text, like_count, published_at, parent_comment_id (nullable, for replies), fetched_at
- `comment_reviews`: id, comment_id, category (respond / ignore / delete_troll / delete_spam / flag_political), confidence_score, draft_reply_text, draft_voice (josh / jeb / house, which host register the draft was written in, see Section 6), status (pending / approved / edited / rejected / posted / deleted), reviewed_by, reviewed_at, action_taken_at
- `authors`: id, channel_id, channel_url, display_name, offense_count (troll/spam actions taken against this author), **blocked (boolean, default false), blocked_at, blocked_by, blocked_reason (single_attack / accumulated_pattern)**, first_seen_at, last_flagged_at
- `action_log`: id, comment_review_id, action_type, performed_by, performed_at, full audit trail of every post/delete/dismiss

---

## 5. Comment Categorization Taxonomy

Calibrated against real TEHB comments pulled during spec review. Use these as few-shot examples in the categorization prompt.

**`respond`**, genuine questions, substantive disagreement worth engaging, or comments that open a CTA opportunity (pointing to another video or the Roadmap). Example: a viewer raising the out-of-state depreciation tax angle on a housing policy video, worth a real reply, CTA optional, not forced.

**`ignore`**, low-value praise, generic reactions, nothing actionable. Example: "Good information." No action needed, just gets marked reviewed so it stops showing as unhandled.

**`delete_troll`**, insults or hostility directed at the hosts or brand that aren't part of a bot pattern. Example: "yall are genuinely idiots."

**Blocking policy (per Josh):** the standard is mutual respect, not benefit-of-the-doubt for hostility.
- If a comment is **unambiguously** an attack on the hosts or brand, delete it and block the author immediately, on the first instance. No pattern required.
- If a comment is hostile but **ambiguous** (could be sarcasm, could be blunt-but-fair criticism rather than an attack), delete the comment but hold the block decision. Accumulate offense_count and surface the author for one-click blocking once they hit 2 to 3 troll-flagged comments.
- The categorizer should emit a confidence score with every `delete_troll` tag so the app can branch automatically: high confidence, block eligible on comment #1. Lower confidence, accumulate, don't block yet, but always delete the individual comment either way.
- **Blocking mechanism:** verify during build whether the YouTube Data API exposes a channel-level user block/ban. It may not, in which case blocking has to happen manually in YouTube Studio. Regardless of platform-level support, maintain the `blocked` flag in our own `authors` table as the source of truth: any future comment from a blocked author is auto-deleted on ingestion, before it ever reaches the review queue or categorization.

**`delete_spam`**, bot/scam patterns. Two known signatures to calibrate on:
1. Fake trading/investment testimonial clusters, a comment claiming huge portfolio gains crediting a named "trading expert," followed by multiple reply-shaped comments from other accounts corroborating it. These arrive as coordinated clusters, not single comments. The categorizer should treat a comment thread where the top comment and several of its replies all follow this pattern as one spam cluster, not evaluate replies independently.
2. Hidden link injection, comments with empty or malformed anchor tags pointing to other channel IDs, often disguised as innocuous text (e.g. "Henderson Nevada, 250,000, three hour drive to coast" with an invisible link appended).

Auto-delete-and-report only after the staged autonomy period (Section 7).

**`flag_political`**, contentious/political content, regardless of how it would otherwise categorize. This tag overrides `respond`: even if a political comment raises a substantive point worth answering, it never gets an auto-posted reply. It always sits in a manual queue for Josh or Jeb to answer personally or dismiss. Reference calibration: past TEHB replies on politically charged threads stay deliberately measured ("politicians of both parties haven't delivered for everyday Americans"). Don't let the model manufacture a stance, just flag and wait for a human.

**Cross-comment signal (stretch goal, not MVP-blocking):** When a meaningful share of comments on a single video cluster around the same complaint (e.g. 15+ comments pushing back on a video's title framing), surface that as a standalone insight in the dashboard, separate from individual comment triage. This is a content-strategy signal, not a moderation action.

---

## 6. Voice & Reply Drafting Guidelines

Feed these constraints into the drafting prompt. The binding source is the
tehb-website voice docs (`docs/voice/anti-slop-SKILL.md` and the Tier A pattern
ban, `docs/editorial/FACTS-CANON.md` for the offer ladder and source rules, plus
the two host voice-analysis docs). Key points, restated for the prompt:

**Shared rules (every reply, both channels):**

- No em dashes, ever. This is Josh's standing rule across all output. Use commas, parentheses, or a full stop.
- Direct language, no flattery, no filler, no hedging. No Tier A slop patterns (negative parallelism, false suspense, rhetorical-question-and-answer, patronizing analogy).
- Data claims cited to a named source when relevant. "Experts say" / unattributed percentages don't ship, this is non-negotiable for TEHB content.
- CTA (Roadmap link or a related video) is available but not mandatory on every reply, use it when it's a natural fit, not as a default close. Comment replies are not the Roadmap CTA context that podcast episodes are. Note the offer ladder: Quiz (rung 1), Blueprint workshop (rung 2), Roadmap conversation (rung 3, where actual numbers happen). Never blur the rungs or promise personal numbers a comment reply can't deliver.
- On political or contentious topics: never generate an auto-postable reply. These always route to `flag_political` regardless of content quality.
- Match the register already visible in TEHB's own past replies: measured, doesn't take the bait, redirects to substance.

**Whose voice (TEHB channel is two hosts, pick the register by topic):**

TEHB replies come in two distinct voices. The drafter should select which based on the comment's subject, and the review UI should show which voice a draft is written in so Josh or Jeb can retag it in one click if the topic is mixed.

- **Josh (mortgage/financing lens)**, per `docs/voice/josh-voice-analysis.md`. Use for rates, loan structure, refinancing, points, MI, FHA vs conventional, qualification vs affordability, closing costs. His moves: deconstruct the "call center" pitch, side-by-side comparison, "different tools for different jobs," reframe lowest-rate to total-cost. Comfortable being blunt about bad advice.
- **Jeb (real estate / buying-process lens)**, per `docs/voice/jeb-voice-analysis.md`. Use for agent questions, offers/contingencies, the search process, local vs national market, timing your life vs timing the market, "don't settle." His moves: personal story as proof (traded 2.9% for 7% for more space), the "two rules," geographic funnel, normalize the anxiety. Conversational, tag-question "right?" cadence.
- Comments that don't clearly belong to either lens (general praise-with-a-question, show feedback) default to a neutral TEHB house voice that still obeys all shared rules. On the personal channel (`@joshlewisCMC`), always draft in Josh's voice.
- Never blend the two into a fake merged persona. Pick one. A reply reads as one person talking, not a committee.

---

## 7. Staged Autonomy / Safety Rails

- **Baseline (all categories, all channels):** human approval required before any post or delete action.
- **`delete_spam` fast track (per Josh, moving faster here on purpose):** the two spam signatures found during spec review (coordinated trading-testimonial clusters, hidden link injection) are mechanically distinct and low-ambiguity, this category doesn't need an extended trust-building period. Graduate to scheduled auto-run once **25 flagged instances have been human-reviewed with zero overturned decisions, spanning at least two distinct spam signatures, with a minimum floor of 7 days** even if 25 instances resolve faster, so precision isn't validated against a single narrow burst of near-identical comments. Once graduated, `delete_spam` runs on the standard polling cadence with no daily human check required.
  - **Make the action reversible, that's the actual safety net for moving fast:** implement `delete_spam`'s auto-action as `comments.setModerationStatus` with status `rejected`, not a hard delete or `markAsSpam`. A rejected comment is hidden from public view immediately, same practical effect as removal, but can be restored if a false positive slips through post-graduation. Confirm this behavior holds during build, but if accurate, it's the reason fast-tracking spam is low-risk rather than reckless, a mistake isn't permanent. Recommend the same reversible-hide approach for `delete_troll` as well, even though troll deletion stays human-gated, better default than an irreversible hard delete across the board.
  - Keep every auto-actioned spam comment visible in a "recently auto-actioned" view in the dashboard so Josh and Jeb can spot-check after the fact without slowing anything down in real time.
- **`delete_troll` and `respond` stay approval-gated indefinitely.** Troll deletion involves a real judgment call (attack vs. disagreement) and posted replies are public brand voice, both deserve a human check every time regardless of how fast the spam trust-window resolves.
- **`flag_political` never graduates.** Permanent by design, not a phase-1 limitation.

---

## 8. MVP Feature List

1. YouTube OAuth connection flow per channel (Josh authorizes both)
2. NextAuth login with allowlist, role-based channel access (Josh: both, Jeb: TEHB only)
3. Comment ingestion:
   - **Cadence:** YouTube's API has no comment webhook, ingestion is polling-based. Default to every 10 to 15 minutes via a scheduled job (Vercel Cron or similar). This cadence is the real ceiling on how fast spam gets caught, not the categorization step, worth knowing going in given the ASAP requirement on spam.
   - **Backlog scope:** don't pull full channel history on day one, that risks a large first-run hit on both API quota and Claude categorization spend, and dumps an overwhelming queue at launch. Default to a 90-day backlog window per channel, configurable, with a manual trigger for a deeper historical pull later once the workflow is trusted.
   - **Dedup on ingestion:** if a comment thread already has a reply from the channel's own authenticated account (confirmed present in the sample pull, several TEHB threads already had host replies), mark it resolved on ingestion rather than re-categorizing and re-queuing it.
   - **YouTube's native held-for-review queue:** YouTube's own spam filters already hold some comments for manual approval in Studio, separate from this app entirely. Code should check whether `commentThreads.list` with the right moderation status filter surfaces that existing backlog too, possibly a fast independent win.
4. Categorization pass via Claude (server-side), stored per comment with confidence score
5. Draft reply generation for `respond`-tagged comments
6. Review queue UI: filter by channel/category, see draft reply, edit inline, approve-and-post / approve-and-delete / dismiss
7. Author offense tracking, repeat-offender surfacing
8. Full action audit log

## Phase 2 (post-trial)

- Digest notification (email or similar) summarizing queue state
- Bulk actions for the review queue
- Cross-comment content-signal clustering (Section 5)

*(Scheduled auto-run for `delete_spam` is not listed here, it's covered in Section 7 and can graduate within the first couple weeks of real usage, not gated to a later phase.)*

---

## 9. Environment Variables (draft list, confirm exact names during build)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
ALLOWED_EMAILS=josh@buywisemortgage.com,jeb@jebsmith.net
ANTHROPIC_API_KEY=
DATABASE_URL=
TOKEN_ENCRYPTION_KEY=
```

---

## 10. Future: Multi-Platform Expansion (Instagram, TikTok, Facebook, X/Twitter, LinkedIn)

Once clips/Shorts get pushed to Instagram, TikTok, and Facebook, the plan is one aggregated dashboard covering all four platforms rather than a separate tool per platform. The schema in Section 4 is already generalized (platform-agnostic `channels` and `authors` tables) so this is additive later, not a rebuild. Do not build adapters for these platforms now, this section is context for later scoping, not current-sprint work.

Reality check per platform, so expectations are calibrated ahead of time:

- **YouTube**, what's being built in this spec. Official Data API v3, comment read/write is mature, well-documented, and this is the reference implementation the other adapters will follow.
- **Instagram / Facebook (both Meta)**, reachable via the Instagram Graph API and Facebook Graph API. Both require a Business/Creator account linked to a Facebook Page, and comment-moderation-level permissions go through Meta's app review and business verification. Budget real lead time for that approval process separately from build time, it is not instant.
- **TikTok**, the least certain. TikTok's public developer APIs have historically had narrower, more gated access to comment management than YouTube or Meta, and access tiers change. This needs fresh research at the time it's actually scoped rather than assuming today's access model holds. Possible it ends up as read-and-flag-only (no automated reply/delete) depending on what's available when we get there.
- **X/Twitter**, technically capable (fetch replies, post replies, hide replies, block accounts all exist as API operations), but access sits behind paid tiers that have been repriced repeatedly and free-tier access is too thin for real comment-monitoring volume. This is a cost-benefit decision, not an engineering one: confirm the API bill is worth it before scoping the build. Also confirm TEHB clips are actually planned for X distribution before prioritizing this, it wasn't part of the original IG/TikTok/FB rollout plan.
- **LinkedIn**, likely not viable at all without an existing partner relationship. Comment-moderation-level API access is gated behind LinkedIn's partner program, built for approved platforms (Hootsuite, Sprout Social, etc.), not something a self-built tool can get into on request. Treat this as a standing "probably closed" item rather than a "revisit later" item like TikTok, unless BuyWise already has a LinkedIn partner relationship.

When this gets built out, each platform becomes its own adapter implementing the same interface (fetch comments, categorize, draft reply, post reply, delete/report, block author) against the same review queue UI, so the human workflow stays identical across platforms even though the underlying API calls differ.

---

## 11. Open Items for Claude Code to Confirm or Flag Back

- Whether extending the existing tehb-website OAuth client's scopes triggers a Google consent-screen re-review, and if so, expected turnaround.
- Whether Jeb has (or should get) Manager-level permission on the TEHB YouTube brand account directly, versus the app-mediated model described in Section 3.
- Whether the YouTube Data API exposes a native channel-level user block/ban, or whether blocking is manual-only in YouTube Studio (Section 5 blocking policy needs this answered to know what's automatable vs. what surfaces as a manual action item for Josh/Jeb).
- Database provider preference (Vercel Postgres vs Supabase), default to Vercel Postgres unless there's a reason not to.
- Confirm YouTube Data API daily quota is sufficient for both channels' comment volume plus categorization polling frequency; request a quota increase from Google if needed before launch.
