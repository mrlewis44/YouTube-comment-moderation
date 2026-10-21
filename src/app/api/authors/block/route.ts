// POST /api/authors/block: one-click block or unblock from the repeat
// offenders list (SPEC Section 5). Human click only.
//
// Body: { authorId: number, block: boolean }

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { blockAuthor, unblockAuthor } from "@/lib/moderation";

export const dynamic = "force-dynamic";

const body = z.object({ authorId: z.number().int().positive(), block: z.boolean() });

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
  const actor = { email: session.user.email, channels: session.user.channels };
  try {
    const result = input.block ? await blockAuthor(input.authorId, actor) : await unblockAuthor(input.authorId, actor);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
