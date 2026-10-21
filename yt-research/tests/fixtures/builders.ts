/**
 * Builders for YouTube Data API v3 response bodies, shaped like real
 * responses (string statistics, nested authorChannelId.value, etc.).
 */
import type {
  ChannelResource,
  CommentResource,
  CommentThreadResource,
  ListResponse,
  PlaylistItemResource,
  VideoResource,
} from "@/lib/types";
import { TtlCache, YouTubeClient } from "@/lib/youtube";

export const OWNER = "UCownerownerownerowner01";
export const VIEWER = "UCviewerviewerviewervi01";
export const API_KEY = "AIzaTEST-not-a-real-key-000000000000";

export function comment(
  id: string,
  opts: { author?: string; authorId?: string; text?: string; likes?: number; publishedAt?: string; videoId?: string; parentId?: string } = {},
): CommentResource {
  return {
    id,
    snippet: {
      authorDisplayName: opts.author ?? "@viewer",
      authorChannelId: { value: opts.authorId ?? VIEWER },
      channelId: OWNER,
      videoId: opts.videoId ?? "vid00000001",
      textDisplay: opts.text ?? `comment ${id}`,
      textOriginal: opts.text ?? `comment ${id}`,
      parentId: opts.parentId,
      likeCount: opts.likes ?? 0,
      publishedAt: opts.publishedAt ?? "2026-10-01T12:00:00Z",
      updatedAt: opts.publishedAt ?? "2026-10-01T12:00:00Z",
    },
  };
}

export function thread(
  id: string,
  opts: {
    total?: number;
    replies?: CommentResource[];
    authorId?: string;
    publishedAt?: string;
    videoId?: string;
    likes?: number;
  } = {},
): CommentThreadResource {
  const replies = opts.replies ?? [];
  return {
    id,
    snippet: {
      channelId: OWNER,
      videoId: opts.videoId ?? "vid00000001",
      topLevelComment: comment(id, {
        authorId: opts.authorId,
        publishedAt: opts.publishedAt,
        videoId: opts.videoId,
        likes: opts.likes,
      }),
      canReply: true,
      totalReplyCount: opts.total ?? replies.length,
      isPublic: true,
    },
    ...(replies.length ? { replies: { comments: replies } } : {}),
  };
}

export function ownerReply(id: string, parentId: string, publishedAt = "2026-10-02T12:00:00Z") {
  return comment(id, { author: "@owner", authorId: OWNER, parentId, publishedAt });
}

export function viewerReply(id: string, parentId: string, publishedAt = "2026-10-02T12:00:00Z") {
  return comment(id, { author: "@someone", authorId: VIEWER, parentId, publishedAt });
}

export function video(
  id: string,
  opts: { views?: number; duration?: string; publishedAt?: string; live?: "none" | "live" | "upcoming"; title?: string; channelId?: string } = {},
): VideoResource {
  return {
    id,
    snippet: {
      publishedAt: opts.publishedAt ?? "2026-10-10T00:00:00Z",
      channelId: opts.channelId ?? OWNER,
      title: opts.title ?? `Video ${id}`,
      channelTitle: "Buy Right, Borrow Smart",
      liveBroadcastContent: opts.live ?? "none",
      thumbnails: {
        high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480, height: 360 },
        maxres: { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, width: 1280, height: 720 },
      },
    },
    statistics: { viewCount: String(opts.views ?? 1000), likeCount: "50", commentCount: "10" },
    contentDetails: { duration: opts.duration ?? "PT12M30S" },
  };
}

export function channel(id = OWNER): ChannelResource {
  return {
    id,
    snippet: {
      title: "Buy Right, Borrow Smart",
      customUrl: "@buyrightborrowsmart",
      publishedAt: "2019-01-01T00:00:00Z",
      country: "US",
      thumbnails: { high: { url: "https://yt3.ggpht.com/x=s800" } },
    },
    statistics: { viewCount: "1000000", subscriberCount: "25000", hiddenSubscriberCount: false, videoCount: "400" },
    contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } },
  };
}

export function page<T>(items: T[], nextPageToken?: string): ListResponse<T> {
  return { items, ...(nextPageToken ? { nextPageToken } : {}) };
}

export function playlistItem(videoId: string): PlaylistItemResource {
  return { id: `pli-${videoId}`, contentDetails: { videoId } };
}

export type Route = (endpoint: string, params: URLSearchParams) => unknown | Response | undefined;

/**
 * Mock fetch: routes by endpoint name and query params. Records every call
 * (with the key stripped) so tests can assert quota and pagination.
 */
export function mockFetch(route: Route) {
  const calls: { endpoint: string; params: URLSearchParams; rawUrl: string }[] = [];
  const fetchImpl = async (url: string): Promise<Response> => {
    const u = new URL(url);
    const endpoint = u.pathname.split("/").pop() ?? "";
    calls.push({ endpoint, params: u.searchParams, rawUrl: url });
    const body = route(endpoint, u.searchParams);
    if (body instanceof Response) return body;
    if (body === undefined) {
      return new Response(JSON.stringify({ error: { code: 404, message: `no mock for ${endpoint}` } }), { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

export function makeClient(route: Route) {
  const { fetchImpl, calls } = mockFetch(route);
  const client = new YouTubeClient({ apiKey: API_KEY, fetch: fetchImpl, cache: new TtlCache() });
  return { client, calls };
}
