// Turns Google OAuth and YouTube Data API failures into a typed error with a
// plain-English message Josh can act on. Pure (no network) so it is unit-tested.
//
// The case that matters most: Google answers a refresh-token exchange with
// `invalid_grant` when the token expired or was revoked. An OAuth app whose
// consent screen is still in "Testing" publishing status gets its refresh
// tokens expired after 7 days, so the channel silently stops syncing a week
// after it was connected. The message says exactly what to do about it.

export type YouTubeErrorKind =
  | "not_connected" // no refresh token stored for this channel
  | "invalid_grant" // refresh token expired or revoked
  | "oauth_client" // client id/secret wrong or missing
  | "quota" // daily YouTube quota used up
  | "forbidden" // token is for an account that cannot moderate this channel
  | "comments_disabled"
  | "not_found" // comment or video no longer exists
  | "bad_request"
  | "network"
  | "other";

export class YouTubeApiError extends Error {
  readonly kind: YouTubeErrorKind;
  readonly status: number | null;
  readonly reason: string | null;

  constructor(kind: YouTubeErrorKind, message: string, status: number | null = null, reason: string | null = null) {
    super(message);
    this.name = "YouTubeApiError";
    this.kind = kind;
    this.status = status;
    this.reason = reason;
  }

  /** Errors that mean the stored token is unusable and Josh must reconnect. */
  get needsReconnect(): boolean {
    return this.kind === "invalid_grant" || this.kind === "not_connected";
  }
}

/** Classify a failed POST to https://oauth2.googleapis.com/token. */
export function classifyTokenError(status: number, body: unknown): YouTubeApiError {
  const b = (body ?? {}) as { error?: string; error_description?: string };
  const code = typeof b.error === "string" ? b.error : null;
  const desc = typeof b.error_description === "string" ? b.error_description : "";
  if (code === "invalid_grant") {
    return new YouTubeApiError("invalid_grant", `invalid_grant${desc ? `: ${desc}` : ""}`, status, code);
  }
  if (code === "invalid_client" || code === "unauthorized_client") {
    return new YouTubeApiError("oauth_client", `${code}${desc ? `: ${desc}` : ""}`, status, code);
  }
  return new YouTubeApiError("other", `Token refresh failed (${status}${code ? ` ${code}` : ""})`, status, code);
}

/** Classify a failed YouTube Data API v3 call from its JSON error body. */
export function classifyApiError(status: number, body: unknown, what: string): YouTubeApiError {
  const err = ((body ?? {}) as { error?: { message?: string; errors?: { reason?: string }[] } }).error;
  const reason = err?.errors?.[0]?.reason ?? null;
  const msg = `${what} failed (${status}${reason ? ` ${reason}` : ""})${err?.message ? `: ${err.message}` : ""}`;

  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    return new YouTubeApiError("quota", msg, status, reason);
  }
  if (reason === "commentsDisabled") return new YouTubeApiError("comments_disabled", msg, status, reason);
  if (status === 404 || reason === "commentNotFound" || reason === "videoNotFound") {
    return new YouTubeApiError("not_found", msg, status, reason);
  }
  if (status === 401) return new YouTubeApiError("invalid_grant", msg, status, reason);
  if (status === 403) return new YouTubeApiError("forbidden", msg, status, reason);
  if (status === 400) return new YouTubeApiError("bad_request", msg, status, reason);
  return new YouTubeApiError("other", msg, status, reason);
}

/**
 * The sentence shown in the UI and stored on the sync run. Written for Josh,
 * not for a developer: what happened and what to do next.
 */
export function friendlyYouTubeError(err: unknown, channelName: string): string {
  if (!(err instanceof YouTubeApiError)) {
    const raw = err instanceof Error ? err.message : String(err);
    return `${channelName}: something went wrong (${raw}).`;
  }
  switch (err.kind) {
    case "not_connected":
      return `${channelName} is not connected to YouTube yet. Connect it at /connect while signed in to the Google account that owns the channel.`;
    case "invalid_grant":
      return (
        `YouTube access for ${channelName} has expired or was revoked (Google returned invalid_grant). ` +
        `Reconnect the channel at /connect. If this happens again about 7 days after connecting, the Google ` +
        `OAuth consent screen is still in Testing mode, which expires refresh tokens after 7 days. In Google ` +
        `Cloud Console open APIs and Services, then OAuth consent screen, and check the Publishing status. ` +
        `Set it to In production so the connection stops expiring.`
      );
    case "oauth_client":
      return `Google rejected the app's OAuth client for ${channelName} (${err.reason}). Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.`;
    case "quota":
      return `The YouTube API daily quota is used up, so ${channelName} could not sync. It resets at midnight Pacific. Nothing is lost, the next sync picks up where this one stopped.`;
    case "forbidden":
      return (
        `YouTube refused the request for ${channelName} (${err.reason ?? "forbidden"}). The connected Google ` +
        `account probably does not own or manage this channel. Reconnect at /connect and pick the channel's ` +
        `own account (for TEHB, the brand account) in Google's account picker.`
      );
    case "comments_disabled":
      return `Comments are turned off on that video, so YouTube would not accept the action.`;
    case "not_found":
      return `YouTube could not find that comment anymore. The author may have deleted it.`;
    case "bad_request":
      return `YouTube rejected the request as invalid (${err.reason ?? err.message}).`;
    case "network":
      return `Could not reach YouTube for ${channelName} (${err.message}). Try Sync now again in a minute.`;
    default:
      return `${channelName}: YouTube error (${err.message}).`;
  }
}
