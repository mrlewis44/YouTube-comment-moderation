// POST /api/draft-reply — proxy to Claude for reply drafting.
// Auth-gated. flag_political never gets an auto-postable reply (SPEC Sections 5, 6),
// so this route refuses to draft for it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { draftReply } from "@/lib/anthropic";

const body = z.object({
  channelKey: z.string(),
  channelName: z.string(),
  videoTitle: z.string().nullish(),
  text: z.string().min(1),
  category: z.string().optional(),
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

  if (input.category === "flag_political") {
    return NextResponse.json(
      { error: "Political comments never get an auto-drafted reply. They wait for a human." },
      { status: 422 },
    );
  }

  try {
    const result = await draftReply(input);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Drafting failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
