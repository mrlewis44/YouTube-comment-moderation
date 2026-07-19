// Server-side Claude calls. The ANTHROPIC_API_KEY never reaches the browser;
// the UI calls our own /api/categorize and /api/draft-reply routes, which call
// this module (SPEC Section 3). Model: Claude Sonnet (SPEC Section 3).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ENV } from "./env";
import { CATEGORIES, DRAFT_VOICES, OPPORTUNITY_TYPES } from "./domain";
import { CATEGORIZE_SYSTEM, DRAFT_SYSTEM } from "./prompts";

const MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (!client) client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  return client;
}

export const categorizeResult = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  // Cross-cutting opportunity signal (SPEC Section 8a).
  opportunityType: z.enum(OPPORTUNITY_TYPES).default("none"),
  opportunityScore: z.number().min(0).max(1).default(0),
});
export type CategorizeResult = z.infer<typeof categorizeResult>;

export const draftResult = z.object({
  draft: z.string(),
  voice: z.enum(DRAFT_VOICES),
});
export type DraftResult = z.infer<typeof draftResult>;

// Pull the first JSON object out of a model response.
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model response");
  return JSON.parse(text.slice(start, end + 1));
}

export async function categorizeComment(input: {
  channelName: string;
  videoTitle?: string | null;
  text: string;
  threadContext?: string;
}): Promise<CategorizeResult> {
  const user = [
    `Channel: ${input.channelName}`,
    input.videoTitle ? `Video: ${input.videoTitle}` : null,
    input.threadContext ? `Thread context:\n${input.threadContext}` : null,
    `Comment:\n${input.text}`,
    ``,
    `Respond with a JSON object: {"category": one of ${CATEGORIES.join(" | ")}, "confidence": 0..1, "reason": short string, "opportunityType": one of ${OPPORTUNITY_TYPES.join(" | ")}, "opportunityScore": 0..1}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 350,
    system: CATEGORIZE_SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  return categorizeResult.parse(extractJson(raw));
}

export async function draftReply(input: {
  channelKey: string;
  channelName: string;
  videoTitle?: string | null;
  text: string;
}): Promise<DraftResult> {
  const user = [
    `Channel: ${input.channelName} (${input.channelKey})`,
    input.videoTitle ? `Video: ${input.videoTitle}` : null,
    `Comment to reply to:\n${input.text}`,
    ``,
    `Respond with a JSON object: {"draft": the reply text, "voice": one of ${DRAFT_VOICES.join(" | ")}}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const msg = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 500,
    system: DRAFT_SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  const textBlock = msg.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  const parsed = draftResult.parse(extractJson(raw));
  return { ...parsed, draft: stripEmDashes(parsed.draft) };
}

/**
 * Hard guarantee of Josh's absolute no-em-dash rule (SPEC Section 6). The prompt
 * asks for none, this makes sure. Em dash and en dash both go; spaced dashes
 * become a comma, tight dashes become nothing so hyphenated-style joins read cleanly.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.,!?])/g, "$1");
}
