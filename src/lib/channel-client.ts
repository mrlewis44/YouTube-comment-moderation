// Builds the YouTube client for a stored channel row and keeps the channel's
// token health up to date (drives the "reconnect" banner).

import { eq } from "drizzle-orm";
import { db, channels, type Channel } from "@/db";
import { decryptToken } from "./crypto";
import { YouTubeClient } from "./youtube";
import { YouTubeApiError, friendlyYouTubeError } from "./youtube-errors";

export function clientForChannel(row: Channel): YouTubeClient {
  let token: string | null = null;
  if (row.oauthRefreshToken) {
    try {
      token = decryptToken(row.oauthRefreshToken);
    } catch {
      // Key rotated or row corrupted: treat as needing a reconnect.
      throw new YouTubeApiError(
        "invalid_grant",
        "Stored token could not be decrypted (TOKEN_ENCRYPTION_KEY changed?)",
      );
    }
  }
  return new YouTubeClient(token);
}

/** Record or clear a token problem on the channel row. Never throws. */
export async function noteTokenHealth(channelId: number, channelName: string, err: unknown | null): Promise<void> {
  try {
    if (err === null) {
      await db.update(channels).set({ tokenError: null, tokenErrorAt: null }).where(eq(channels.id, channelId));
    } else if (err instanceof YouTubeApiError && err.kind === "invalid_grant") {
      await db
        .update(channels)
        .set({ tokenError: friendlyYouTubeError(err, channelName), tokenErrorAt: new Date() })
        .where(eq(channels.id, channelId));
    }
  } catch {
    // Health bookkeeping must never break the caller.
  }
}
