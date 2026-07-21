// Thin YouTube Data API v3 client (SPEC Sections 3, 8). Uses fetch directly to
// keep deps light. All calls are server-side. Needs the youtube.force-ssl scope
// (SPEC Section 11 open item). A refresh token (authorized per channel) is
// exchanged for a short-lived access token per call.
//
// Mock mode: when constructed without a refresh token, read calls return the
// sample threads so ingestion can be developed and demoed before a channel is
// connected. Write calls are no-ops that report back what they would have done.

import { ENV } from "./env";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://www.googleapis.com/youtube/v3";

export type RawCommentThread = {
  threadId: string;
  topComment: RawComment;
  replies: RawComment[];
};

export type RawComment = {
  id: string;
  videoId: string;
  authorDisplayName: string;
  authorChannelUrl: string | null;
  text: string;
  likeCount: number;
  publishedAt: string;
  parentId: string | null;
};

export type ModerationStatus = "published" | "heldForReview" | "likelySpam" | "rejected";

export class YouTubeClient {
  private refreshToken: string | null;
  readonly mock: boolean;

  constructor(refreshToken: string | null) {
    this.refreshToken = refreshToken;
    this.mock = !refreshToken;
  }

  private async accessToken(): Promise<string> {
    if (!this.refreshToken) throw new Error("No refresh token for this channel");
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: ENV.googleClientId,
        client_secret: ENV.googleClientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const token = await this.accessToken();
    const url = `${API_BASE}/${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`YouTube GET ${path} failed: ${res.status}`);
    return res.json();
  }

  private async post(path: string, params: Record<string, string>, body?: unknown): Promise<any> {
    const token = await this.accessToken();
    const url = `${API_BASE}/${path}?${new URLSearchParams(params)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`YouTube POST ${path} failed: ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  /**
   * All comment threads on a channel's videos, newest first. Paginates until
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
      const data = await this.get("commentThreads", {
        part: "snippet,replies",
        allThreadsRelatedToChannelId: channelId,
        maxResults: "100",
        order: "time",
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of data.items ?? []) {
        const thread = mapThread(item);
        threads.push(thread);
      }
      // Stop paging once we are older than the backlog window.
      const oldest = data.items?.[data.items.length - 1]?.snippet?.topLevelComment?.snippet
        ?.publishedAt;
      if (opts.publishedAfter && oldest && new Date(oldest) < opts.publishedAfter) break;
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return threads;
  }

  /** Post a public reply to a comment thread. */
  async replyToComment(parentId: string, text: string): Promise<{ id: string } | { mocked: true }> {
    if (this.mock) return { mocked: true };
    const res = await this.post("comments", { part: "snippet" }, {
      snippet: { parentId, textOriginal: text },
    });
    return { id: res.id };
  }

  /**
   * Hide a comment reversibly (SPEC Section 7): setModerationStatus=rejected.
   * Reversible restore is setModerationStatus=published. Preferred over a hard
   * delete or markAsSpam so a false positive can be undone.
   */
  async setModerationStatus(
    commentId: string,
    status: "rejected" | "published",
  ): Promise<{ ok: true } | { mocked: true }> {
    if (this.mock) return { mocked: true };
    await this.post("comments/setModerationStatus", {
      id: commentId,
      moderationStatus: status,
    });
    return { ok: true };
  }
}

function mapThread(item: any): RawCommentThread {
  const top = item.snippet.topLevelComment;
  const videoId = item.snippet.videoId;
  return {
    threadId: item.id,
    topComment: mapComment(top, videoId, null),
    replies: (item.replies?.comments ?? []).map((c: any) => mapComment(c, videoId, item.id)),
  };
}

function mapComment(c: any, videoId: string, parentId: string | null): RawComment {
  const s = c.snippet;
  return {
    id: c.id,
    videoId,
    authorDisplayName: s.authorDisplayName ?? "",
    authorChannelUrl: s.authorChannelUrl ?? null,
    text: s.textOriginal ?? s.textDisplay ?? "",
    likeCount: s.likeCount ?? 0,
    publishedAt: s.publishedAt,
    parentId,
  };
}

// Mock threads derived from the review-queue samples, shaped like API output.
function mockThreads(_channelId: string): RawCommentThread[] {
  return [
    {
      threadId: "t1",
      topComment: {
        id: "c1",
        videoId: "vid_policy",
        authorDisplayName: "@growthminded",
        authorChannelUrl: "https://youtube.com/@growthminded",
        text: "One thing nobody mentions is the out of state depreciation angle.",
        likeCount: 14,
        publishedAt: "2026-07-18T15:04:00Z",
        parentId: null,
      },
      replies: [],
    },
  ];
}
