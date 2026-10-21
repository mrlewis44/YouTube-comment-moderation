import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  QUOTA_NOTE,
  getChannel,
  getChannelVideos,
  getComments,
  getUnansweredComments,
  getVideos,
  searchVideos,
} from "./lib/tools";
import { YouTubeApiError, YouTubeClient } from "./lib/youtube";

export const SERVER_INFO = { name: "yt-research", version: "0.1.0" };

export const SERVER_INSTRUCTIONS =
  "Read-only YouTube research via the official YouTube Data API v3 (API key, no OAuth). " +
  "Pull comments, video stats, channel stats, recent uploads with a median-views baseline, and thumbnail URLs. " +
  "Every result includes the quota it used. The project budget is 10,000 units per day, shared with Comment Copilot; " +
  "search_videos uses a separate bucket of about 100 calls per day, so prefer get_channel_videos when the channel is known. " +
  "Transcripts are not available.";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

type ClientFactory = () => YouTubeClient;

const defaultClientFactory: ClientFactory = () =>
  new YouTubeClient({ apiKey: process.env.YOUTUBE_API_KEY ?? "" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function fail(err: unknown) {
  const message =
    err instanceof YouTubeApiError || err instanceof Error ? err.message : "Unexpected error.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const channelInput = z
  .string()
  .min(2)
  .describe("Channel ID (UC...), @handle, or channel URL.");

export function registerTools(server: McpServer, makeClient: ClientFactory = defaultClientFactory) {
  server.registerTool(
    "get_comments",
    {
      title: "Get video comments",
      description:
        "Top-level comments on one video via commentThreads.list. Returns author, text, likes, reply count, published date, and owner_replied " +
        "(true, false, or null when unknown). Cost: 1 unit for the video lookup + 1 unit per 100 comments, plus 1 unit per thread whose full replies had to be fetched. " +
        "1,000 comments costs about 11 units.",
      inputSchema: z.object({
        video_id: z.string().min(11).describe("Video ID or any YouTube video URL."),
        order: z.enum(["relevance", "time"]).default("relevance").describe("relevance (top comments) or time (newest first)."),
        max_comments: z.number().int().min(1).max(1000).default(100).describe("How many top-level comments to return (1 to 1000)."),
        include_replies: z.boolean().default(false).describe("Include reply text. Threads with more replies than the API embeds cost 1 extra unit each."),
        max_reply_fetches: z.number().int().min(0).max(200).default(25).describe("Cap on extra comments.list calls for full reply lists."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(() => getComments(makeClient(), args)),
  );

  server.registerTool(
    "get_videos",
    {
      title: "Get video stats",
      description:
        "Stats for up to 200 videos via videos.list: title, channel, publish date, views, likes, comment count, duration, views per day, " +
        "short/long format guess, and maxres/high thumbnail URLs. Cost: 1 unit per 50 ids.",
      inputSchema: z.object({
        video_ids: z.array(z.string().min(11)).min(1).max(200).describe("Video IDs or URLs."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(() => getVideos(makeClient(), args)),
  );

  server.registerTool(
    "get_channel",
    {
      title: "Get channel stats",
      description:
        "Channel stats via channels.list: subscribers, total views, video count, average views per video, created date, and the uploads playlist ID. Cost: 1 unit.",
      inputSchema: z.object({ channel: channelInput }),
      annotations: READ_ONLY,
    },
    async (args) => run(() => getChannel(makeClient(), args)),
  );

  server.registerTool(
    "get_channel_videos",
    {
      title: "Get recent uploads with baseline",
      description:
        "A channel's most recent uploads (playlistItems.list on the uploads playlist) with full stats (videos.list). " +
        "Computes the median views of the returned long-form videos (over 3 minutes, not live) as a baseline and each long-form video's ratio to it " +
        "(2.0 = twice the channel's typical video). Cost: 1 unit + 2 units per 50 videos (50 videos = 3 units).",
      inputSchema: z.object({
        channel: channelInput,
        max: z.number().int().min(1).max(200).default(50).describe("How many recent uploads to return (1 to 200)."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(() => getChannelVideos(makeClient(), args)),
  );

  server.registerTool(
    "search_videos",
    {
      title: "Search YouTube videos",
      description:
        "Keyword search via search.list (type=video), optionally enriched with stats. WARNING: search.list uses a SEPARATE quota bucket limited to " +
        "about 100 calls per day by default. Use it sparingly; prefer get_channel_videos when you know the channel. Cost: 1 search call + 1 unit for stats.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search terms."),
        max_results: z.number().int().min(1).max(50).default(10),
        published_after: z.string().optional().describe("Only videos published after this date (YYYY-MM-DD or RFC 3339)."),
        order: z.enum(["relevance", "date", "viewCount", "rating"]).default("relevance"),
        channel_id: z.string().optional().describe("Restrict to one channel (UC... ID)."),
        include_stats: z.boolean().default(true).describe("Add views, likes, duration and thumbnails via videos.list (1 unit)."),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(() => searchVideos(makeClient(), args)),
  );

  server.registerTool(
    "get_unanswered_comments",
    {
      title: "Find unanswered comments",
      description:
        "Top-level comments across all of a channel's videos (commentThreads.list with allThreadsRelatedToChannelId) from the last N days that have " +
        "no reply from the channel owner, newest first, with video titles and direct comment links. Cost: 1 unit per 100 threads scanned, " +
        "+1 per thread whose hidden replies had to be checked, +1 per 50 videos for titles.",
      inputSchema: z.object({
        channel: channelInput,
        days: z.number().int().min(1).max(3650).default(90),
        max_pages: z.number().int().min(1).max(50).default(10).describe("Max pages of 100 threads to scan (1 unit each)."),
        max_reply_checks: z.number().int().min(0).max(200).default(25).describe("Max extra comments.list calls to verify threads with hidden replies."),
        include_video_titles: z.boolean().default(true),
      }),
      annotations: READ_ONLY,
    },
    async (args) => run(() => getUnansweredComments(makeClient(), args)),
  );

  server.registerTool(
    "quota_note",
    {
      title: "Quota costs",
      description: "Static reference: what each tool costs in YouTube Data API quota and what is not supported. Costs 0 units.",
      inputSchema: z.object({}),
      annotations: { ...READ_ONLY, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text" as const, text: QUOTA_NOTE }] }),
  );
}
