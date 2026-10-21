// POST /api/autopilot: pause or resume spam autopilot (SPEC Section 7).
// Admin only. Pausing stops graduated delete_spam auto-hides immediately;
// graduation progress is kept. Body: { paused: boolean }

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { SPAM_AUTOPILOT_PAUSED, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const body = z.object({ paused: z.boolean() });

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  await setSetting(SPAM_AUTOPILOT_PAUSED, input.paused ? "true" : "false", session.user.email);
  return NextResponse.json({ ok: true, paused: input.paused });
}
