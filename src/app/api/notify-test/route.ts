// POST /api/notify-test — send a sample opportunity card to the configured
// Google Chat webhook so Josh can confirm the space is wired before live
// ingestion runs. Auth-gated. Does not touch the database.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { notifyOpportunity } from "@/lib/notify";

export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcome = await notifyOpportunity({
    channel: "tehb",
    videoId: "dQw4w9WgXcQ",
    videoTitle: "FHA vs Conventional in a high cost market",
    author: "@sample_viewer",
    authorChannelUrl: null,
    text: "I make about 95k and have 30k saved. Looking to buy around 420k in Tampa this fall. Who should I talk to about getting pre-approved?",
    platformCommentId: "SAMPLE_COMMENT_ID",
    opportunityType: "loan",
    opportunityScore: 0.86,
  });

  return NextResponse.json(outcome);
}
