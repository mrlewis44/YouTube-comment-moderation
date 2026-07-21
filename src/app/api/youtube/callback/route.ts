// GET /api/youtube/callback — exchange the OAuth code for tokens and store the
// refresh token, encrypted, on the channel row (SPEC Section 3). The refresh
// token is the credential that lets the app read and moderate comments on that
// channel; it never leaves the server and is never sent to the browser.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ENV, youtubeRedirectUri } from "@/lib/env";
import { CHANNELS, type ChannelKey } from "@/lib/domain";
import { encryptToken } from "@/lib/crypto";
import { db, channels } from "@/db";

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return redirectToConnect(url.origin, `denied: ${error}`);
  if (!code || !stateRaw) return redirectToConnect(url.origin, "missing code");

  let channel: ChannelKey;
  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
    channel = state.channel;
    if (!(channel in CHANNELS)) throw new Error("bad channel");
  } catch {
    return redirectToConnect(url.origin, "bad state");
  }

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.googleClientId,
      client_secret: ENV.googleClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: youtubeRedirectUri(),
    }),
  });
  if (!tokenRes.ok) return redirectToConnect(url.origin, `token exchange ${tokenRes.status}`);

  const tokens = (await tokenRes.json()) as { refresh_token?: string };
  if (!tokens.refresh_token) {
    // Happens if the account was already granted and prompt=consent was bypassed.
    return redirectToConnect(url.origin, "no refresh token returned, revoke and retry");
  }

  const meta = CHANNELS[channel];
  const encrypted = encryptToken(tokens.refresh_token);

  await db
    .insert(channels)
    .values({
      platform: "youtube",
      platformChannelId: meta.platformChannelId,
      displayName: meta.displayName,
      oauthRefreshToken: encrypted,
      connectedBy: session.user.email,
      connectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [channels.platform, channels.platformChannelId],
      set: {
        oauthRefreshToken: encrypted,
        connectedBy: session.user.email,
        connectedAt: new Date(),
      },
    });

  return redirectToConnect(url.origin, `connected:${channel}`);
}

function redirectToConnect(origin: string, status: string) {
  return NextResponse.redirect(`${origin}/connect?status=${encodeURIComponent(status)}`);
}
