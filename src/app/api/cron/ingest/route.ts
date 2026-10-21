// GET /api/cron/ingest: the scheduled ingestion tick (SPEC Section 8 cadence).
// Protected by CRON_SECRET: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
//
// Cadence: vercel.json schedules this once a day (13:00 UTC), because the
// current Vercel plan only allows daily cron jobs. SPEC asks for every 10 to 15
// minutes; on a plan that allows it, change the schedule to "*/15 * * * *".
// "Sync now" in the app runs the same pipeline on demand.

import { NextResponse } from "next/server";
import { ENV } from "@/lib/env";
import { runSync } from "@/lib/ingest";
import { CHANNELS, type ChannelKey } from "@/lib/domain";

export const dynamic = "force-dynamic";
// 60s works on every Vercel plan. The pipeline stops starting new Claude work
// well before this and leaves the rest for the next sync.
export const maxDuration = 60;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!ENV.cronSecret || authHeader !== `Bearer ${ENV.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = Object.keys(CHANNELS) as ChannelKey[];
  try {
    const results = await runSync(keys, { trigger: "cron", phase: "full", budgetMs: 52_000 });
    // Logged so failures show up in Vercel's runtime logs, not only in the UI.
    for (const r of results) {
      const line = `[cron ingest] ${r.channel}: ok=${r.ok} fetched=${r.commentsFetched} new=${r.newComments} triaged=${r.triaged} autoHidden=${r.autoHidden} resolved=${r.resolved} remaining=${r.remaining}`;
      if (r.ok) console.log(line);
      else console.error(`${line} error=${r.errorKind}: ${r.error}`);
    }
    return NextResponse.json({ ranAt: new Date().toISOString(), results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed";
    console.error(`[cron ingest] failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
