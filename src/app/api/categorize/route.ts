// POST /api/categorize — proxy to Claude for comment categorization.
// Auth-gated: only allowlisted, signed-in users. Keeps ANTHROPIC_API_KEY
// server-side (SPEC Section 3).

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { categorizeComment } from "@/lib/anthropic";

const body = z.object({
  channelName: z.string(),
  videoTitle: z.string().nullish(),
  text: z.string().min(1),
  threadContext: z.string().optional(),
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
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Categorization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
