/**
 * Tool implementations. Each takes a YouTubeClient so tests can inject a
 * mocked fetch. Every result carries a `quota` block with the units it spent.
 */
import { QuotaMeter, YouTubeClient } from "./youtube";
import type {
  ChannelResource,
  CommentResource,
  CommentThreadResource,
  ListResponse,
  PlaylistItemResource,
  SearchResultResource,
  VideoResource,
} from "./types";
import {
  chunk,
  clamp,
  daysSince,
  formatDuration,
  median,
  normalizeVideoId,
  parseChannelRef,
  parseIsoDuration,
  round,
  toInt,
  toRfc3339,
  truncateText,
} from "./util";

/** Videos at or under this length are treated as Shorts (Shorts can run up to 3 minutes). */
export const SHORT_MAX_SECONDS = 180;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export type OwnerReplied = boolean | null;

/**
 * Did the channel owner reply in this thread?
 * - true: an owner reply is in the replies we have.
 * - false: we have every reply (or there are none) and none is from the owner.
 * - null: unknown. The API only embeds a subset of replies, the owner's was
 *   not among them, and more replies exist than we have.
 */
export function ownerReplyStatus(
  totalReplyCount: number,
  replies: CommentResource[],
  ownerChannelId: string | null,
): OwnerReplied {
  if (!ownerChannelId) return null;
  if (replies.some((r) => r.snippet.authorChannelId?.value === ownerChannelId)) return true;
  if (totalReplyCount === 0 || replies.length >= totalReplyCount) return false;
  return null;
}

/** Fetches every reply to a top-level comment via comments.list (1 unit per page of 100). */
export async function fetchAllReplies(
  client: YouTubeClient,
  parentId: string,
  meter: QuotaMeter,
  maxPages = 3,
): Promise<{ replies: CommentResource[]; complete: boolean }> {
  const replies: CommentResource[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.get<ListResponse<CommentResource>>(
      "comments",
      { part: "snippet", parentId, maxResults: 100, textFormat: "plainText", pageToken },
      meter,
    );
    replies.push(...(res.items ?? []));
    pageToken = res.nextPageToken;
    if (!pageToken) return { replies, complete: true };
  }
  return { replies, complete: false };
}

/** videos.list in batches of 50 ids (1 unit per batch). Preserves input order. */
export async function fetchVideos(
  client: YouTubeClient,
  ids: string[],
  meter: QuotaMeter,
): Promise<VideoResource[]> {
  const byId = new Map<string, VideoResource>();
  for (const batch of chunk(ids, 50)) {
    const res = await client.get<ListResponse<VideoResource>>(
      "videos",
      { part: "snippet,statistics,contentDetails", id: batch.join(","), maxResults: 50 },
      meter,
    );
    for (const v of res.items ?? []) byId.set(v.id, v);
  }
  return ids.map((id) => byId.get(id)).filter((v): v is VideoResource => Boolean(v));
}

/** Resolves a UC id, @handle, or channel URL to a channel resource (1 unit). */
export async function fetchChannel(
  client: YouTubeClient,
  input: string,
  meter: QuotaMeter,
): Promise<ChannelResource> {
  const ref = parseChannelRef(input);
  const res = await client.get<ListResponse<ChannelResource>>(
    "channels",
    {
      part: "snippet,statistics,contentDetails",
      ...(ref.kind === "id" ? { id: ref.value } : { forHandle: ref.value }),
    },
    meter,
  );
  const channel = res.items?.[0];
  if (!channel) throw new Error(`Channel not found: ${input}`);
  return channel;
}

/** UC ids resolve for free; handles cost one channels.list call. */
async function resolveChannelId(client: YouTubeClient, input: string, meter: QuotaMeter): Promise<string> {
  const ref = parseChannelRef(input);
  if (ref.kind === "id") return ref.value;
  return (await fetchChannel(client, input, meter)).id;
}

export interface VideoSummary {
  id: string;
  url: string;
  title: string | null;
  channel: string | null;
  channel_id: string | null;
  published: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  duration: string | null;
  duration_s: number | null;
  views_per_day: number | null;
  format: "short" | "long" | "live" | "upcoming" | "unknown";
  thumbnail_maxres: string | null;
  thumbnail_high: string | null;
}

export function summarizeVideo(v: VideoResource, now: Date): VideoSummary {
  const seconds = parseIsoDuration(v.contentDetails?.duration);
  const views = toInt(v.statistics?.viewCount);
  const published = v.snippet?.publishedAt ?? null;
  const live = v.snippet?.liveBroadcastContent;
  let format: VideoSummary["format"] = "unknown";
  if (live === "live") format = "live";
  else if (live === "upcoming") format = "upcoming";
  else if (seconds !== null && seconds > 0) format = seconds <= SHORT_MAX_SECONDS ? "short" : "long";
  return {
    id: v.id,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: v.snippet?.title ?? null,
    channel: v.snippet?.channelTitle ?? null,
    channel_id: v.snippet?.channelId ?? null,
    published,
    views,
    likes: toInt(v.statistics?.likeCount),
    comments: toInt(v.statistics?.commentCount),
    duration: formatDuration(seconds),
    duration_s: seconds,
    views_per_day: views !== null && published ? round(views / daysSince(published, now), 1) : null,
    format,
    thumbnail_maxres: v.snippet?.thumbnails?.maxres?.url ?? null,
    thumbnail_high: v.snippet?.thumbnails?.high?.url ?? null,
  };
}

/**
 * Median views of long-form videos (over 3 minutes, not live or upcoming),
 * plus each video's views divided by that median. Shorts and live streams
 * get ratio null because they are not comparable to the long-form baseline.
 */
export function withMedianBaseline(videos: VideoSummary[]) {
  const longForm = videos.filter((v) => v.format === "long" && v.views !== null);
  const baseline = median(longForm.map((v) => v.views as number));
  return {
    baseline: {
      long_form_count: longForm.length,
      median_views_long_form: baseline,
      definition: `Median views of returned videos longer than ${SHORT_MAX_SECONDS}s, excluding live and upcoming streams.`,
    },
    videos: videos.map((v) => ({
      ...v,
      ratio_to_median:
        v.format === "long" && v.views !== null && baseline ? round(v.views / baseline, 2) : null,
    })),
  };
}

interface CommentOut {
  id: string;
  author: string | null;
  by_owner?: true;
  text: string;
  likes: number;
  published: string;
  edited?: true;
}

function mapComment(c: CommentResource, ownerChannelId: string | null): CommentOut {
  const s = c.snippet;
  const out: CommentOut = {
    id: c.id,
    author: s.authorDisplayName ?? null,
    text: truncateText(s.textDisplay ?? s.textOriginal ?? ""),
    likes: s.likeCount ?? 0,
    published: s.publishedAt,
  };
  if (ownerChannelId && s.authorChannelId?.value === ownerChannelId) out.by_owner = true;
  if (s.updatedAt && s.updatedAt !== s.publishedAt) out.edited = true;
  return out;
}

// ---------------------------------------------------------------------------
// 1. get_comments
// ---------------------------------------------------------------------------

export interface GetCommentsArgs {
  video_id: string;
  order?: "relevance" | "time";
  max_comments?: number;
  include_replies?: boolean;
  max_reply_fetches?: number;
}

export async function getComments(client: YouTubeClient, args: GetCommentsArgs, now = new Date()) {
  const meter = new QuotaMeter();
  const videoId = normalizeVideoId(args.video_id);
  const order = args.order ?? "relevance";
  const max = clamp(Math.floor(args.max_comments ?? 100), 1, 1000);
  const includeReplies = args.include_replies ?? false;
  const maxReplyFetches = clamp(Math.floor(args.max_reply_fetches ?? 25), 0, 200);

  // 1 unit: the video's owner channel is the authoritative "owner" for reply detection.
  const [video] = await fetchVideos(client, [videoId], meter);
  if (!video) throw new Error(`Video not found or private: ${videoId}`);
  const ownerId = video.snippet?.channelId ?? null;

  const threads: CommentThreadResource[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const res = await client.get<ListResponse<CommentThreadResource>>(
      "commentThreads",
      {
        part: "snippet,replies",
        videoId,
        order,
        maxResults: 100,
        textFormat: "plainText",
        pageToken,
      },
      meter,
    );
    pages += 1;
    threads.push(...(res.items ?? []));
    pageToken = res.nextPageToken;
  } while (pageToken && threads.length < max);

  const kept = threads.slice(0, max);
  let replyFetches = 0;
  let ownerReplied = 0;
  let unknown = 0;

  const comments = [];
  for (const t of kept) {
    const total = t.snippet.totalReplyCount ?? 0;
    let replies = t.replies?.comments ?? [];
    let repliesComplete = replies.length >= total;
    let status = ownerReplyStatus(total, replies, ownerId);

    // Fetch the full reply list when asked, or when it is the only way to know
    // whether the owner replied.
    if (!repliesComplete && (includeReplies || status === null) && replyFetches < maxReplyFetches) {
      replyFetches += 1;
      const full = await fetchAllReplies(client, t.snippet.topLevelComment.id, meter);
      replies = full.replies;
      repliesComplete = full.complete;
      status = ownerReplyStatus(total, replies, ownerId) ?? (full.complete ? false : null);
    }
    if (status === true) ownerReplied += 1;
    if (status === null) unknown += 1;

    const base = mapComment(t.snippet.topLevelComment, ownerId);
    comments.push({
      ...base,
      reply_count: total,
      owner_replied: status,
      ...(includeReplies
        ? {
            replies: [...replies]
              .sort((a, b) => a.snippet.publishedAt.localeCompare(b.snippet.publishedAt))
              .map((r) => mapComment(r, ownerId)),
            ...(repliesComplete ? {} : { replies_truncated: true as const }),
          }
        : {}),
    });
  }

  return {
    video: {
      id: videoId,
      title: video.snippet?.title ?? null,
      channel: video.snippet?.channelTitle ?? null,
      channel_id: ownerId,
      comment_count: toInt(video.statistics?.commentCount),
    },
    order,
    returned: comments.length,
    pages_fetched: pages,
    has_more: Boolean(pageToken) || threads.length > max,
    owner_replied_threads: ownerReplied,
    owner_reply_unknown_threads: unknown,
    comments,
    quota: meter.summary(),
  };
}

// ---------------------------------------------------------------------------
// 2. get_videos
// ---------------------------------------------------------------------------

export async function getVideos(client: YouTubeClient, args: { video_ids: string[] }, now = new Date()) {
  const meter = new QuotaMeter();
  const ids = [...new Set(args.video_ids.map(normalizeVideoId))];
  if (ids.length === 0) throw new Error("Pass at least one video ID.");
  if (ids.length > 200) throw new Error("Pass at most 200 video IDs per call.");
  const videos = await fetchVideos(client, ids, meter);
  const found = new Set(videos.map((v) => v.id));
  return {
    videos: videos.map((v) => summarizeVideo(v, now)),
    not_found: ids.filter((id) => !found.has(id)),
    quota: meter.summary(),
  };
}

// ---------------------------------------------------------------------------
// 3a. get_channel
// ---------------------------------------------------------------------------

export function summarizeChannel(c: ChannelResource) {
  const views = toInt(c.statistics?.viewCount);
  const videos = toInt(c.statistics?.videoCount);
  return {
    id: c.id,
    title: c.snippet?.title ?? null,
    handle: c.snippet?.customUrl ?? null,
    url: `https://www.youtube.com/channel/${c.id}`,
    created: c.snippet?.publishedAt ?? null,
    country: c.snippet?.country ?? null,
    subscribers: c.statistics?.hiddenSubscriberCount ? null : toInt(c.statistics?.subscriberCount),
    subscribers_hidden: Boolean(c.statistics?.hiddenSubscriberCount),
    total_views: views,
    video_count: videos,
    avg_views_per_video: views !== null && videos ? Math.round(views / videos) : null,
    uploads_playlist_id: c.contentDetails?.relatedPlaylists?.uploads ?? null,
    thumbnail: c.snippet?.thumbnails?.high?.url ?? c.snippet?.thumbnails?.default?.url ?? null,
    description: c.snippet?.description ? truncateText(c.snippet.description, 500) : null,
  };
}

export async function getChannel(client: YouTubeClient, args: { channel: string }) {
  const meter = new QuotaMeter();
  const channel = await fetchChannel(client, args.channel, meter);
  return { channel: summarizeChannel(channel), quota: meter.summary() };
}

// ---------------------------------------------------------------------------
// 3b. get_channel_videos
// ---------------------------------------------------------------------------

export async function getChannelVideos(
  client: YouTubeClient,
  args: { channel: string; max?: number },
  now = new Date(),
) {
  const meter = new QuotaMeter();
  const max = clamp(Math.floor(args.max ?? 50), 1, 200);
  const channel = await fetchChannel(client, args.channel, meter);
  const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`Channel ${channel.id} has no uploads playlist.`);

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await client.get<ListResponse<PlaylistItemResource>>(
      "playlistItems",
      { part: "contentDetails", playlistId: uploads, maxResults: 50, pageToken },
      meter,
    );
    for (const item of res.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id && !ids.includes(id)) ids.push(id);
    }
    pageToken = res.nextPageToken;
  } while (pageToken && ids.length < max);

  const videos = (await fetchVideos(client, ids.slice(0, max), meter)).map((v) => summarizeVideo(v, now));
  const { baseline, videos: rated } = withMedianBaseline(videos);
  return {
    channel: {
      id: channel.id,
      title: channel.snippet?.title ?? null,
      handle: channel.snippet?.customUrl ?? null,
      subscribers: channel.statistics?.hiddenSubscriberCount ? null : toInt(channel.statistics?.subscriberCount),
    },
    returned: rated.length,
    baseline,
    videos: rated,
    quota: meter.summary(),
  };
}

// ---------------------------------------------------------------------------
// 4. search_videos
// ---------------------------------------------------------------------------

export interface SearchArgs {
  query: string;
  max_results?: number;
  published_after?: string;
  order?: "relevance" | "date" | "viewCount" | "rating";
  channel_id?: string;
  include_stats?: boolean;
}

export async function searchVideos(client: YouTubeClient, args: SearchArgs, now = new Date()) {
  const meter = new QuotaMeter();
  const max = clamp(Math.floor(args.max_results ?? 10), 1, 50);
  const res = await client.get<ListResponse<SearchResultResource>>(
    "search",
    {
      part: "snippet",
      type: "video",
      q: args.query,
      maxResults: max,
      order: args.order ?? "relevance",
      publishedAfter: args.published_after ? toRfc3339(args.published_after) : undefined,
      channelId: args.channel_id ? parseChannelRef(args.channel_id).value : undefined,
    },
    meter,
  );
  const ids = (res.items ?? []).map((i) => i.id.videoId).filter((id): id is string => Boolean(id));
  let results: unknown[];
  if (args.include_stats ?? true) {
    const videos = await fetchVideos(client, ids, meter);
    results = videos.map((v) => summarizeVideo(v, now));
  } else {
    results = (res.items ?? [])
      .filter((i) => i.id.videoId)
      .map((i) => ({
        id: i.id.videoId,
        url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
        title: i.snippet?.title ?? null,
        channel: i.snippet?.channelTitle ?? null,
        channel_id: i.snippet?.channelId ?? null,
        published: i.snippet?.publishedAt ?? null,
        thumbnail_high: i.snippet?.thumbnails?.high?.url ?? null,
      }));
  }
  return {
    query: args.query,
    returned: results.length,
    results,
    note: "search.list draws on a separate, small daily bucket (about 100 calls per day by default). Prefer get_channel_videos when you already know the channel.",
    quota: meter.summary(),
  };
}

// ---------------------------------------------------------------------------
// 5. get_unanswered_comments
// ---------------------------------------------------------------------------

export interface UnansweredArgs {
  channel: string;
  days?: number;
  max_pages?: number;
  max_reply_checks?: number;
  include_video_titles?: boolean;
}

export async function getUnansweredComments(client: YouTubeClient, args: UnansweredArgs, now = new Date()) {
  const meter = new QuotaMeter();
  const channelId = await resolveChannelId(client, args.channel, meter);
  const days = clamp(Math.floor(args.days ?? 90), 1, 3650);
  const maxPages = clamp(Math.floor(args.max_pages ?? 10), 1, 50);
  const maxReplyChecks = clamp(Math.floor(args.max_reply_checks ?? 25), 0, 200);
  const cutoffMs = now.getTime() - days * 86_400_000;
  const cutoff = new Date(cutoffMs).toISOString();

  type Candidate = { thread: CommentThreadResource; status: OwnerReplied };
  const candidates: Candidate[] = [];
  let scanned = 0;
  let pages = 0;
  let reachedCutoff = false;
  let pageToken: string | undefined;

  do {
    const res = await client.get<ListResponse<CommentThreadResource>>(
      "commentThreads",
      {
        part: "snippet,replies",
        allThreadsRelatedToChannelId: channelId,
        order: "time",
        maxResults: 100,
        textFormat: "plainText",
        pageToken,
      },
      meter,
    );
    pages += 1;
    for (const t of res.items ?? []) {
      const top = t.snippet.topLevelComment;
      if (Date.parse(top.snippet.publishedAt) < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      scanned += 1;
      // The owner's own top-level comments are not "unanswered".
      if (top.snippet.authorChannelId?.value === channelId) continue;
      const status = ownerReplyStatus(t.snippet.totalReplyCount ?? 0, t.replies?.comments ?? [], channelId);
      if (status !== true) candidates.push({ thread: t, status });
    }
    pageToken = res.nextPageToken;
  } while (!reachedCutoff && pageToken && pages < maxPages);

  // Resolve "unknown" threads (owner reply may be hidden past the embedded replies).
  let checks = 0;
  for (const c of candidates) {
    if (c.status !== null || checks >= maxReplyChecks) continue;
    checks += 1;
    const full = await fetchAllReplies(client, c.thread.snippet.topLevelComment.id, meter);
    const total = c.thread.snippet.totalReplyCount ?? 0;
    c.status = ownerReplyStatus(total, full.replies, channelId) ?? (full.complete ? false : null);
  }

  const unanswered = candidates.filter((c) => c.status === false);
  const unverified = candidates.filter((c) => c.status === null);

  const titles = new Map<string, string>();
  if (args.include_video_titles ?? true) {
    const videoIds = [
      ...new Set([...unanswered, ...unverified].map((c) => c.thread.snippet.videoId).filter(Boolean) as string[]),
    ];
    for (const v of await fetchVideos(client, videoIds, meter)) {
      if (v.snippet?.title) titles.set(v.id, v.snippet.title);
    }
  }

  const toOut = (c: Candidate) => {
    const vid = c.thread.snippet.videoId ?? null;
    const top = c.thread.snippet.topLevelComment;
    return {
      video_id: vid,
      video_title: vid ? (titles.get(vid) ?? null) : null,
      ...mapComment(top, channelId),
      reply_count: c.thread.snippet.totalReplyCount ?? 0,
      url: vid ? `https://www.youtube.com/watch?v=${vid}&lc=${top.id}` : null,
    };
  };
  const newestFirst = (a: Candidate, b: Candidate) =>
    b.thread.snippet.topLevelComment.snippet.publishedAt.localeCompare(
      a.thread.snippet.topLevelComment.snippet.publishedAt,
    );

  return {
    channel_id: channelId,
    window_days: days,
    since: cutoff,
    threads_scanned: scanned,
    pages_fetched: pages,
    scan_complete: reachedCutoff || !pageToken,
    ...(reachedCutoff || !pageToken
      ? {}
      : { scan_note: `Stopped after max_pages=${maxPages} before reaching the ${days}-day cutoff. Raise max_pages to scan further.` }),
    unanswered_count: unanswered.length,
    unanswered: unanswered.sort(newestFirst).map(toOut),
    ...(unverified.length
      ? {
          unverified_count: unverified.length,
          unverified_note:
            "These threads have more replies than the API embeds and were not checked (max_reply_checks reached). The owner may have replied.",
          unverified: unverified.sort(newestFirst).map(toOut),
        }
      : {}),
    quota: meter.summary(),
  };
}

// ---------------------------------------------------------------------------
// 6. quota_note
// ---------------------------------------------------------------------------

export const QUOTA_NOTE = `# yt-research quota costs (YouTube Data API v3)

Source: developers.google.com/youtube/v3/determine_quota_cost (page last updated 2026-10-08) and the captions.download reference page. Checked 2026-10-20.

Daily budget: 10,000 units per Google Cloud project, shared with Comment Copilot (same project). Resets at midnight Pacific time.

| Tool | API calls | Cost |
| --- | --- | --- |
| get_comments | videos.list (1) + commentThreads.list, 1 per page of 100 threads + comments.list, 1 per thread whose full replies were needed | 100 comments = 2 units; 1,000 comments = 11 units, plus reply fetches |
| get_videos | videos.list, 1 per 50 ids | 1 to 4 units |
| get_channel | channels.list | 1 unit |
| get_channel_videos | channels.list (1) + playlistItems.list (1 per 50) + videos.list (1 per 50) | 50 videos = 3 units |
| search_videos | search.list (separate bucket) + videos.list (1) when include_stats | 1 search call + 1 unit |
| get_unanswered_comments | commentThreads.list (1 per 100 threads) + comments.list (1 per checked thread) + videos.list (1 per 50 videos) | typically 5 to 40 units |

search.list has its own quota bucket with a default limit of about 100 calls per day, separate from the 10,000 units. Use it sparingly.

Cached results (10 minute in-memory cache per server instance) cost 0 units and show up as cache_hits.

Not supported: transcripts or captions of other channels. captions.download costs 200 units and requires OAuth plus edit permission on the video, and this server is API-key only and read-only. captions.list alone costs 50 units and does not return caption text.`;
