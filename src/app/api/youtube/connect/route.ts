// GET /api/youtube/connect?channel=tehb — start the per-channel YouTube
// authorization (SPEC Sections 2, 3). This is separate from app login: it
// authorizes the app to read and moderate comments as the channel-owning
// account. Admin only. Redirects to Google's consent screen with the
// youtube.force-ssl scope and offline access so we receive a refresh token.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ENV, YOUTUBE_SCOPE, youtubeRedirectUri } from "@/lib/env";
import { CHANNELS, type ChannelKey } from "@/lib/domain";

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const channel = new URL(req.url).searchParams.get("channel");
  if (!channel || !(channel in CHANNELS)) {
    return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
  }

  // State carries the channel key and the authorizing user, signed by the
  // session; a stricter build would add a CSRF nonce cookie here.
  const state = Buffer.from(
    JSON.stringify({ channel: channel as ChannelKey, by: session.user.email }),
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id: ENV.googleClientId,
    redirect_uri: youtubeRedirectUri(),
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh token every time
    include_granted_scopes: "true",
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  );
}
