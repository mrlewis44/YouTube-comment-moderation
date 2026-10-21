/** The subset of YouTube Data API v3 response shapes this server reads. */

export interface PageInfo {
  totalResults?: number;
  resultsPerPage?: number;
}

export interface ListResponse<T> {
  items?: T[];
  nextPageToken?: string;
  pageInfo?: PageInfo;
}

export interface Thumbnail {
  url: string;
  width?: number;
  height?: number;
}

export type Thumbnails = Partial<Record<"default" | "medium" | "high" | "standard" | "maxres", Thumbnail>>;

export interface CommentResource {
  id: string;
  snippet: {
    authorDisplayName?: string;
    authorChannelId?: { value?: string };
    channelId?: string;
    videoId?: string;
    textDisplay?: string;
    textOriginal?: string;
    parentId?: string;
    likeCount?: number;
    publishedAt: string;
    updatedAt?: string;
  };
}

export interface CommentThreadResource {
  id: string;
  snippet: {
    channelId?: string;
    videoId?: string;
    topLevelComment: CommentResource;
    canReply?: boolean;
    totalReplyCount?: number;
    isPublic?: boolean;
  };
  replies?: { comments?: CommentResource[] };
}

export interface VideoResource {
  id: string;
  snippet?: {
    publishedAt: string;
    channelId: string;
    title: string;
    description?: string;
    channelTitle?: string;
    thumbnails?: Thumbnails;
    tags?: string[];
    liveBroadcastContent?: "none" | "live" | "upcoming";
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
}

export interface ChannelResource {
  id: string;
  snippet?: {
    title: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    country?: string;
    thumbnails?: Thumbnails;
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
}

export interface PlaylistItemResource {
  id: string;
  contentDetails?: { videoId: string; videoPublishedAt?: string };
  snippet?: { title?: string; publishedAt?: string };
}

export interface SearchResultResource {
  id: { kind: string; videoId?: string; channelId?: string };
  snippet?: {
    publishedAt: string;
    channelId: string;
    title: string;
    description?: string;
    channelTitle?: string;
    thumbnails?: Thumbnails;
    liveBroadcastContent?: string;
  };
}
