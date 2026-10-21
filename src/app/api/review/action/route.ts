// POST /api/review/action: a reviewer's decision on one queue item, applied
// to YouTube and recorded in the action log. Every call here is a human click
// (SPEC Section 7: post, hide, and block stay human-approved).
//
// Body: { reviewId: number, action: post_reply | hide | hide_and_block | dismiss | restore, text?: string }

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { REVIEW_ACTIONS, performReviewAction } from "@/lib/moderation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const body = z.object({
  reviewId: z.number().int().positive(),
  action: z.enum(REVIEW_ACTIONS),
  text: z.string().max(12_000).optional(),
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
    const result = await performReviewAction({
      reviewId: input.reviewId,
      action: input.action,
      text: input.text,
      actor: { email: session.user.email, channels: session.user.channels },
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Action failed" }, { status: 500 });
  }
}
