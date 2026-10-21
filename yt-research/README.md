# yt-research

A small, read-only MCP server that lets Claude pull YouTube comments, video stats, channel stats and thumbnail URLs through the official YouTube Data API v3. It replaces vidIQ credit spend for routine research on Buy Right, Borrow Smart and competitor channels.

- Owner: Josh Lewis (Buy Right, Borrow Smart)
- Lives in the Comment Copilot repo under `yt-research/`, but it is its own app with its own `package.json` and deploys as a separate Vercel project (Root Directory = `yt-research`).
- Stack: Next.js 16 App Router route handler, TypeScript, `mcp-handler` 2.3 (Vercel) on the official MCP SDK v2 (`@modelcontextprotocol/server` 2.3), zod 4. Transport is Streamable HTTP.

## Tools

Every tool returns compact JSON with a `quota` block: `units_used` (from the 10,000/day budget), `search_calls_used` (separate search bucket), `api_calls`, and `cache_hits`.

| Tool | What it returns | API calls |
| --- | --- | --- |
| `get_comments(video_id, order=relevance\|time, max_comments=100, include_replies=false)` | Top-level comments: author, text, likes, reply count, published date, `owner_replied` (true, false, or null when unknown). Optional reply text with the owner's replies flagged. | `videos.list` x1, `commentThreads.list` x1 per 100, `comments.list` x1 per thread whose full replies were needed |
| `get_videos(video_ids[])` | Title, channel, publish date, views, likes, comment count, duration, views per day, short/long format guess, maxres and high thumbnail URLs. Up to 200 ids. | `videos.list` x1 per 50 ids |
| `get_channel(channel)` | Subscribers, total views, video count, average views per video, created date, uploads playlist ID. Accepts a UC id, @handle, or channel URL. | `channels.list` x1 |
| `get_channel_videos(channel, max=50)` | Recent uploads with full stats, plus the median views of the returned long-form videos and each long-form video's `ratio_to_median` (2.0 means twice the channel's typical video). | `channels.list` x1, `playlistItems.list` x1 per 50, `videos.list` x1 per 50 |
| `search_videos(query, max_results=10, published_after?, order?, channel_id?, include_stats=true)` | Keyword search results, optionally with stats. | `search.list` x1 (separate bucket), `videos.list` x1 |
| `get_unanswered_comments(channel, days=90)` | Top-level comments on any of the channel's videos from the last N days with no reply from the channel owner, newest first, with video title and a direct comment link. | `commentThreads.list` x1 per 100 threads, `comments.list` x1 per thread with hidden replies (capped), `videos.list` x1 per 50 videos |
| `quota_note` | Static cost reference. | none |

Notes on the logic:

- **Owner reply detection.** The API embeds only some replies in each thread. A thread is `owner_replied: true` when any reply's author channel ID equals the video's channel ID, `false` when all replies are present and none is the owner's, and `null` when replies are truncated and no owner reply is visible. The tools spend 1 unit per truncated thread on `comments.list` to settle those, up to `max_reply_fetches` / `max_reply_checks` (default 25). Anything left unsettled is reported as unknown or "unverified", never guessed.
- **Long-form baseline.** Long-form means longer than 180 seconds and not live or upcoming. Shorts can run up to 3 minutes, so 180 seconds is the cutoff. Shorts and streams get `ratio_to_median: null`.
- **Views per day** is views divided by days since publish, with a 1-day floor.
- **Cache.** Identical API requests are cached in memory for 10 minutes (500 entries max) per warm server instance. Cache hits cost 0 units.

## Quota math

Sources, checked 2026-10-20: [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) (page last updated 2026-10-08), [captions.download](https://developers.google.com/youtube/v3/docs/captions/download), [commentThreads.list](https://developers.google.com/youtube/v3/docs/commentThreads/list).

- The Google Cloud project gets **10,000 units per day**. This key lives in the same project as Comment Copilot, so the two apps share that 10,000. Quota resets at midnight Pacific time.
- `commentThreads.list`, `comments.list`, `videos.list`, `channels.list`, `playlistItems.list`: **1 unit per call**. Comment and thread pages hold up to 100 items; video and playlist pages hold up to 50.
- `search.list` has **its own quota bucket**, with a default limit of about **100 calls per day**. It does not draw from the 10,000 units, but it runs out fast. Prefer `get_channel_videos` when you know the channel.
- Failed calls still count.

Typical costs:

| Job | Units |
| --- | --- |
| 100 comments on one video | 2 |
| 1,000 comments on one video | 11, plus up to 25 for truncated reply threads |
| Stats for 50 videos | 1 |
| A channel's last 50 uploads with median baseline | 3 |
| Unanswered comments, 90 days, a channel with 600 comment threads | 6 to 8, plus reply checks |
| One search with stats | 1 search call + 1 unit |

Example day: 1,000 comments on each of 10 videos (110 units) plus 5 competitor upload scans (15 units) is about 125 units, 1.25% of the shared 10,000.

### Not supported: transcripts

Transcripts of other channels' videos are not available through this server. `captions.download` costs 200 units and requires OAuth with edit permission on the video, and `captions.list` (50 units) returns caption track metadata, not text. This server uses an API key only and is read-only, so it cannot download captions for any video, including Josh's own. Keep using the vidIQ transcript tool for transcripts.

## Security model

- **Strictly read-only.** The client can only issue `GET` requests to an allowlist of six read endpoints (`commentThreads`, `comments`, `videos`, `channels`, `playlistItems`, `search`). There is no code path for any insert, update, delete, rate, or moderation call, and no OAuth or channel tokens are used anywhere. Every tool is annotated `readOnlyHint: true`.
- **API key.** Read from `YOUTUBE_API_KEY` on the server only. It is never put in logs, cache keys, tool output, or error messages (errors are scrubbed of it). Restrict the key to the YouTube Data API v3 so a leak cannot be used against other Google APIs.
- **Endpoint gate.** Every MCP request must present `MCP_ACCESS_TOKEN`, either as an `Authorization: Bearer <token>` header on `/mcp`, or as a path segment `/mcp/<token>` for clients that cannot send headers. Comparison is constant time. If `MCP_ACCESS_TOKEN` is missing or shorter than 32 characters, the server fails closed with 503 and serves nothing. Wrong or missing tokens get 401 before any MCP or YouTube work happens, so strangers cannot burn quota. Unexpected paths get 404.
- **Header beats path.** A token in the URL can show up in Vercel request logs and browser history. Use the header option in claude.ai (see setup). Use the path form only if a client cannot send headers, and rotate the token if the URL is ever shared.
- **No logging.** The server does not log requests, tool arguments, the key, or the token (`verboseLogs` is off).
- **Rotation.** To rotate, set a new `MCP_ACCESS_TOKEN` in Vercel, redeploy, and update the connector. To rotate the API key, create a new key, swap `YOUTUBE_API_KEY`, redeploy, then delete the old key.

## Setup for Josh

### 1. Create the API key (Google Cloud console)

1. Open [console.cloud.google.com](https://console.cloud.google.com) and pick the **same project Comment Copilot uses** (top bar project picker).
2. Go to **APIs and Services > Library**, search "YouTube Data API v3", and confirm it shows **Enabled** (Comment Copilot already enabled it).
3. Go to **APIs and Services > Credentials > Create credentials > API key**.
4. On the new key, click **Edit API key**:
   - Name: `yt-research`.
   - **API restrictions > Restrict key**, check only **YouTube Data API v3**, and save.
   - Application restrictions: leave as **None** (Vercel serverless functions do not have fixed IP addresses).
5. Copy the key. You will paste it into Vercel in step 3. Do not paste it into chat or commit it.

### 2. Create the access token

Generate a long random secret on your Mac:

```bash
openssl rand -hex 32
```

That prints 64 characters. This is `MCP_ACCESS_TOKEN`. Store it in your password manager.

### 3. Create the Vercel project

1. In Vercel, **Add New > Project**, and import the `mrlewis44/youtube-comment-moderation` repo again (a second project from the same repo).
2. Project name: `yt-research`.
3. **Root Directory: `yt-research`**. Framework preset: Next.js (auto-detected).
4. Under **Environment Variables**, add for Production (and Preview if you want preview deploys to work):
   - `YOUTUBE_API_KEY` = the key from step 1
   - `MCP_ACCESS_TOKEN` = the secret from step 2
5. Deploy. Visiting the root URL should show a one-line "yt-research" message. Visiting `/mcp` without a token should return `{"error":"Unauthorized."}`.
6. Optional: under **Settings > Git > Ignored Build Step**, use "Only build if there are changes in a folder" with `yt-research` so Comment Copilot commits do not redeploy this project.

### 4. Add it to claude.ai as a custom connector

Per the [Claude Help Center](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp):

Pro or Max account:

1. **Customize > Connectors > + Add > Add custom connector**.
2. Name: `yt-research`. URL: `https://<your-vercel-domain>/mcp`.
3. Authentication: **No sign in**. (Claude may detect a sign-in requirement because the server answers 401 without the header. Switch it to No sign in.)
4. **Request headers**: add `Authorization` with value `Bearer <MCP_ACCESS_TOKEN>`.
5. Click **Add**, then enable it in a chat from the tools menu.

Team or Enterprise account: an Owner adds it at **Organization settings > Connectors > Add > Custom > Web** with the same URL, "No sign in", and the same request header. Members then click **Connect** under Customize > Connectors.

Fallback if headers are not available in your client: use the URL `https://<your-vercel-domain>/mcp/<MCP_ACCESS_TOKEN>` with "No sign in" and no headers.

Claude Code: `claude mcp add --transport http yt-research https://<your-vercel-domain>/mcp --header "Authorization: Bearer <MCP_ACCESS_TOKEN>"`.

### 5. Try it

Ask Claude: "Use yt-research to pull the top 200 comments on <video URL> and tell me which ones we have not answered", or "Run get_channel_videos on @<competitor handle> and show me their outliers."

## Development

```bash
cd yt-research
npm install
npm run typecheck
npm test          # vitest, mocked API responses, no network
npm run build
cp .env.example .env.local   # then fill in values
npm run dev                  # http://localhost:3000/mcp
```

Tests cover pagination (comments, uploads playlist, 50-id video batches), owner-reply detection against a recorded API page, hidden-reply resolution, the unanswered-comment cutoff, the median baseline math, the auth gate, key redaction, the cache, and an end-to-end MCP round trip through the real route handler.

Layout:

```
app/mcp/[[...token]]/route.ts   auth gate + mcp-handler (Streamable HTTP)
app/route.ts                    public one-line landing response
src/server.ts                   tool registration (zod schemas, descriptions)
src/lib/tools.ts                tool logic, quota note
src/lib/youtube.ts              read-only API client, cache, quota meter
src/lib/auth.ts                 token extraction and constant-time check
src/lib/util.ts                 id parsing, durations, median
tests/                          vitest suites and fixtures
```
