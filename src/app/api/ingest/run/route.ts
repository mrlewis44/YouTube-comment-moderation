// POST /api/ingest/run — admin-triggered ingestion for the user's channels.
// Lets Josh pull comments on demand instead of waiting for the daily cron.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ingestChannel } from "@/lib/ingest";
import type { ChannelKey } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const results = [];
  for (const key of session.user.channels as ChannelKey[]) {
    try {
      results.push(await ingestChannel(key));
    } catch (err) {
      results.push({ channel: key, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
