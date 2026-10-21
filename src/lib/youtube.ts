// Thin YouTube Data API v3 client (SPEC Sections 3, 8). Uses fetch directly to
// keep deps light. All calls are server-side and need the youtube.force-ssl
// scope. A refresh token (authorized per channel) is exchanged for a
// short-lived access token, cached for the life of the client.
//
// Failures throw YouTubeApiError (see youtube-errors.ts) so callers can show a
// plain-English message, most importantly for invalid_grant (token expired).
//
// Mock mode: only when explicitly allowed (local dev, or COPILOT_MOCK_YOUTUBE=1).
// Read calls return sample threads, write calls are no-ops that report back.
// In production a channel without a token is "not connected", never mocked,
// so sample data can never leak into the live database.
//
// Quota costs (units, 10,000/day default): commentThreads.list 1,
// comments.list 1, videos.list 1, channels.list 1, comments.insert 50,
// comments.setModerationStatus 50 (up to 50 ids per call).

import { ENV } from "./env";
import { YouTubeApiError, classifyApiError, classifyTokenError } from "./youtube-errors";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

export type RawCommentThread = {
  threadId: string;
  topComment: RawComment;
  replies: RawComment[];
  // YouTube returns at most 5 replies inline; this is the real count.
  totalReplyCount: number;
};

export type RawComment = {
  id: string;
  videoId: string;
  authorDisplayName: string;
  authorChannelUrl: string | null;
  authorChannelId: string | null;
  text: string;
  // textDisplay (HTML). Hidden link injection shows up only here.
  textHtml: string | null;
  likeCount: number;
  publishedAt: string;
  parentId: string | null;
};

/**
 * How a comment is hidden.
 *
 * SPEC Section 7 asked for setModerationStatus=rejected as the reversible hide
 * and said to confirm it during the build. Google's reference for
 * comments.setModerationStatus says a rejected comment cannot be set back to
 * published, so rejected is NOT reversible through the API. heldForReview is:
 * the comment leaves public view and lands in YouTube Studio's "Held for
 * review" tab, where it can be approved (or published again via the API).
 * So the reversible hide is heldForReview, and rejected is kept for the
 * deliberate "hide and block author" action, where banAuthor requires it.
 */
export type HideStatus = "heldForReview" | "rejected";
export const REVERSIBLE_HIDE: HideStatus = "heldForReview";

export class YouTubeClient {
  private refreshToken: string | null;
  private cachedAccessToken: string | null = null;
  readonly mock: boolean;

  constructor(refreshToken: string | null, opts: { allowMock?: boolean } = {}) {
    this.refreshToken = refreshToken;
    this.mock = !refreshToken && (opts.allowMock ?? ENV.allowMockYouTube);
    if (!refreshToken && !this.mock) {
      throw new YouTubeApiError("not_connected", "No YouTube refresh token stored for this channel");
    }
  }

  private async accessToken(): Promise<string> {
    if (this.cachedAccessToken) return this.cachedAccessToken;
    if (!this.refreshToken) throw new YouTubeApiError("not_connected", "No refresh token for this channel");
    let res: Response;
    try {
      res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          refresh_token: this.refreshToken,
          grant_type: "refresh_token",
        }),
      });
    } catch (err) {
      throw new YouTubeApiError("network", err instanceof Error ? err.message : "fetch failed");
    }
    if (!res.ok) throw classifyTokenError(res.status, await safeJson(res));
    const json = (await res.json()) as { access_token: string };
    this.cachedAccessToken = json.access_token;
    return json.access_token;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    body?: unknown,
  ): Promise<any> {
    const token = await this.accessToken();
    const url = `${API_BASE}/${path}?${new URLSearchParams(params)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new YouTubeApiError("network", err instanceof Error ? err.message : "fetch failed");
    }
    if (!res.ok) throw classifyApiError(res.status, await safeJson(res), `YouTube ${method} ${path}`);
    return res.status === 204 ? null : res.json();
  }

  /** Confirms the token works. Returns the channel id the token belongs to. */
  async ownChannelIds(): Promise<string[]> {
    if (this.mock) return [];
    const data = await this.request("GET", "channels", { part: "id", mine: "true" });
    return (data.items ?? []).map((c: { id: string }) => c.id);
  }

  /**
   * Comment threads on a channel's videos, newest first. Paginates until
   * `publishedAfter` is crossed or pages run out. In mock mode returns samples.
   */
  async listChannelThreads(
    channelId: string,
    opts: { publishedAfter?: Date; maxPages?: number } = {},
  ): Promise<RawCommentThread[]> {
    if (this.mock) return mockThreads(channelId);

    const threads: RawCommentThread[] = [];
    let pageToken: string | undefined;
    const maxPages = opts.maxPages ?? 20;
    for (let page = 0; page < maxPages; page++) {
      const data = await this.request("GET", "commentThreads", {
        part: "snippet,replies",
        allThreadsRelatedToChannelId: channelId,
        maxResults: "100",
        order: "time",
        textFormat: "html",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of data.items ?? []) {
        const thread = mapThread(item);
        if (opts.publishedAfter && new Date(thread.topComment.publishedAt) < opts.publishedAfter) continue;
        threads.push(thread);
      }
      const oldest = data.items?.[data.items.length - 1]?.snippet?.topLevelComment?.snippet?.publishedAt;
      if (opts.publishedAfter && oldest && new Date(oldest) < opts.publishedAfter) break;
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return threads;
  }

  /** Every reply in a thread (commentThreads only inlines up to 5). */
  async listReplies(parentId: string, videoId: string): Promise<RawComment[]> {
    if (this.mock) return [];
    const out: RawComment[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const data = await this.request("GET", "comments", {
        part: "snippet",
        parentId,
        maxResults: "100",
        textFormat: "html",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const c of data.items ?? []) out.push(mapComment(c, videoId, parentId));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  /** Video titles by id (50 per call). */
  async videoTitles(videoIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (this.mock) {
      for (const id of videoIds) out[id] = MOCK_VIDEO_TITLES[id] ?? "Sample video";
      return out;
    }
    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const data = await this.request("GET", "videos", { part: "snippet", id: chunk.join(",") });
      for (const v of data.items ?? []) out[v.id] = v.snippet?.title ?? "";
    }
    return out;
  }

  /** Post a public reply into a comment thread. parentId must be the thread (top-level) id. */
  async replyToComment(parentId: string, text: string): Promise<{ id: string; mocked?: boolean }> {
    if (this.mock) return { id: `mock-reply-${Date.now()}`, mocked: true };
    const res = await this.request("POST", "comments", { part: "snippet" }, {
      snippet: { parentId, textOriginal: text },
    });
    return { id: res.id };
  }

  /**
   * Change moderation status for up to 50 comments in one call (50 quota
   * units). banAuthor only applies with "rejected" (YouTube's "hide user from
   * channel"; undo it in YouTube Studio under Settings, Community, Hidden users).
   */
  async setModerationStatus(
    commentIds: string[],
    status: HideStatus | "published",
    opts: { banAuthor?: boolean } = {},
  ): Promise<{ ok: true; mocked?: boolean }> {
    if (commentIds.length === 0) return { ok: true };
    if (this.mock) return { ok: true, mocked: true };
    for (let i = 0; i < commentIds.length; i += 50) {
      await this.request("POST", "comments/setModerationStatus", {
        id: commentIds.slice(i, i + 50).join(","),
        moderationStatus: status,
        ...(opts.banAuthor && status === "rejected" ? { banAuthor: "true" } : {}),
      });
    }
    return { ok: true };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function mapThread(item: any): RawCommentThread {
  const top = item.snippet.topLevelComment;
  const videoId = item.snippet.videoId;
  return {
    threadId: item.id,
    topComment: mapComment(top, videoId, null),
    replies: (item.replies?.comments ?? []).map((c: any) => mapComment(c, videoId, item.id)),
    totalReplyCount: item.snippet.totalReplyCount ?? 0,
  };
}

export function mapComment(c: any, videoId: string, parentId: string | null): RawComment {
  const s = c.snippet ?? {};
  return {
    id: c.id,
    videoId: s.videoId ?? videoId,
    authorDisplayName: s.authorDisplayName ?? "",
    authorChannelUrl: s.authorChannelUrl ?? null,
    authorChannelId: s.authorChannelId?.value ?? null,
    text: s.textOriginal ?? stripHtml(s.textDisplay ?? ""),
    textHtml: s.textDisplay ?? null,
    likeCount: s.likeCount ?? 0,
    publishedAt: s.publishedAt,
    parentId: s.parentId ?? parentId,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

const MOCK_VIDEO_TITLES: Record<string, string> = {
  vid_policy: "Is the new housing policy actually good for buyers?",
  vid_fha: "FHA vs Conventional in a high cost market",
};

// Mock threads for local development, shaped like API output. Ids are
// prefixed "mock-" so they can never collide with real YouTube ids.
function mockThreads(channelId: string): RawCommentThread[] {
  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000).toISOString();
  const c = (
    id: string,
    author: string,
    text: string,
    hoursAgo: number,
    opts: Partial<RawComment> = {},
  ): RawComment => ({
    id: `mock-${channelId}-${id}`,
    videoId: "vid_policy",
    authorDisplayName: author,
    authorChannelUrl: `http://www.youtube.com/${author}`,
    authorChannelId: `UCmock_${author.replace(/\W/g, "")}`,
    text,
    textHtml: text,
    likeCount: 0,
    publishedAt: iso(hoursAgo),
    parentId: null,
    ...opts,
  });
  return [
    {
      threadId: `mock-${channelId}-t1`,
      topComment: c("t1", "@growthminded", "One thing nobody mentions is the out of state depreciation angle. Would love your take?", 30),
      replies: [],
      totalReplyCount: 0,
    },
    {
      threadId: `mock-${channelId}-t2`,
      topComment: c("t2", "@firsttimebuyer_sd", "So FHA can be cheaper than conventional even with good credit? My LO said FHA is only for people who can't qualify.", 50, { videoId: "vid_fha" }),
      replies: [],
      totalReplyCount: 0,
    },
  ];
}
