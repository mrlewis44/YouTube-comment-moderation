// GET /api/cron/ingest — the scheduled ingestion tick (SPEC Section 8 cadence).
// Called by Vercel Cron every 10-15 min. Protected by CRON_SECRET: Vercel Cron
// sends `Authorization: Bearer $CRON_SECRET`. Runs both channels; a per-channel
// failure does not abort the others.

import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { ingestChannel } from "@/lib/ingest";
import { CHANNELS, type ChannelKey } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!ENV.cronSecret || authHeader !== `Bearer ${ENV.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = [];
  for (const key of Object.keys(CHANNELS) as ChannelKey[]) {
    try {
      results.push(await ingestChannel(key));
    } catch (err) {
      results.push({ channel: key, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
