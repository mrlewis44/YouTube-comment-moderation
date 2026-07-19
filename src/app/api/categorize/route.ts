// POST /api/categorize — proxy to Claude for comment categorization.
// Auth-gated: only allowlisted, signed-in users. Keeps ANTHROPIC_API_KEY
// server-side (SPEC Section 3).

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { categorizeComment } from "@/lib/anthropic";
import { notifyOpportunity } from "@/lib/notify";
import type { ChannelKey } from "@/lib/domain";

const body = z.object({
  channelName: z.string(),
  videoTitle: z.string().nullish(),
  text: z.string().min(1),
  threadContext: z.string().optional(),
  // Optional context so a cleared opportunity can be routed to Google Chat.
  channel: z.string().optional(),
  videoId: z.string().optional(),
  author: z.string().optional(),
  platformCommentId: z.string().optional(),
  authorChannelUrl: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const result = await categorizeComment(input);

    // Fire a Google Chat ping when this looks like a real client opportunity.
    // Requires enough context to build the deep link; skipped otherwise.
    let notified = false;
    if (input.channel && input.videoId && input.author && input.platformCommentId) {
      const outcome = await notifyOpportunity({
        channel: input.channel as ChannelKey,
        videoId: input.videoId,
        videoTitle: input.videoTitle ?? null,
        author: input.author,
        authorChannelUrl: input.authorChannelUrl ?? null,
        text: input.text,
        platformCommentId: input.platformCommentId,
        opportunityType: result.opportunityType,
        opportunityScore: result.opportunityScore,
      });
      notified = outcome.sent;
    }

    return NextResponse.json({ ...result, notified });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Categorization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
