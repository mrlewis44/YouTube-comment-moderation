// POST /api/ingest/run: admin-triggered sync ("Sync now") for the user's
// channels, so Josh does not have to wait for the daily cron.
//
// Body (optional): { "phase": "full" | "triage" }. "full" pulls from YouTube
// and then triages; "triage" only works through comments already stored. The
// Sync now button calls "full" once, then repeats "triage" until the backlog
// is categorized.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { runSync } from "@/lib/ingest";
import type { ChannelKey } from "@/lib/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ phase: z.enum(["full", "triage"]).default("full") });

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let phase: "full" | "triage" = "full";
  try {
    const text = await req.text();
    phase = body.parse(text ? JSON.parse(text) : {}).phase;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const results = await runSync(session.user.channels as ChannelKey[], {
      trigger: "manual",
      phase,
      budgetMs: 50_000,
    });
    return NextResponse.json({ ranAt: new Date().toISOString(), phase, results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Sync failed" }, { status: 500 });
  }
}
