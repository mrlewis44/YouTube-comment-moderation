// Server-side Claude calls. The ANTHROPIC_API_KEY never reaches the browser;
// the UI calls our own /api/categorize and /api/draft-reply routes, which call
// this module (SPEC Section 3). Model: Claude Sonnet (SPEC Section 3).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ENV } from "./env";
import { CATEGORIES, DRAFT_VOICES, OPPORTUNITY_TYPES } from "./domain";
import { SPAM_SIGNATURES } from "./graduation";
import { CATEGORIZE_SYSTEM, DRAFT_SYSTEM } from "./prompts";

// SPEC Section 3: Claude Sonnet. The optional ANTHROPIC_MODEL env var changes
// the model id without a code change.
const MODEL = ENV.anthropicModel || "claude-sonnet-5-5";

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
  // Which spam signature matched (SPEC 5, 7). Only meaningful for delete_spam.
  spamSignature: z.enum(SPAM_SIGNATURES).nullish().catch(null),
  // Is the commenter asking something (drives the unanswered-backlog sort).
  isQuestion: z.boolean().nullish().catch(null),
});
export type CategorizeResult = z.infer<typeof categorizeResult>;

export const draftResult = z.object({
  draft: z.string(),
  voice: z.enum(DRAFT_VOICES),
  // Safety net for SPEC 5/6: the drafter refuses political comments too.
  political: z.boolean().optional().default(false),
});
export type DraftResult = z.infer<typeof draftResult>;

// Pull the first JSON object out of a model response.
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model response");
  return JSON.parse(text.slice(start, end + 1));
}

// Exported for unit tests.
export { extractJson };

export async function categorizeComment(input: {
  channelName: string;
  videoTitle?: string | null;
  text: string;
  threadContext?: string;
  // Hidden link injection signals from the rendered HTML (spam signature 2).
  linkSignals?: string[];
}): Promise<CategorizeResult> {
  const user = [
    `Channel: ${input.channelName}`,
    input.videoTitle ? `Video: ${input.videoTitle}` : null,
    input.threadContext ? `Thread context:\n${input.threadContext}` : null,
    input.linkSignals?.length ? `Link signals:\n- ${input.linkSignals.join("\n- ")}` : null,
    `Comment:\n${input.text}`,
    ``,
    `Respond with a JSON object: {"category": one of ${CATEGORIES.join(" | ")}, "confidence": 0..1, "reason": short string, "spamSignature": one of ${SPAM_SIGNATURES.join(" | ")} or null when not spam, "isQuestion": true | false, "opportunityType": one of ${OPPORTUNITY_TYPES.join(" | ")}, "opportunityScore": 0..1}.`,
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
    `Respond with a JSON object: {"draft": the reply text, "voice": one of ${DRAFT_VOICES.join(" | ")}, "political": true | false}.`,
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
  return {
    ...parsed,
    draft: parsed.political ? "" : stripEmDashes(parsed.draft),
    // SPEC 6: the personal channel is always Josh's voice.
    voice: input.channelKey === "josh" ? "josh" : parsed.voice,
  };
}

/**
 * Hard guarantee of Josh's absolute no-em-dash rule (SPEC Section 6). The prompt
 * asks for none, this makes sure. Em dash and en dash both go; spaced dashes
 * become a comma, tight dashes become nothing so hyphenated-style joins read cleanly.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.,!?])/g, "$1");
}

/**
 * Plain-English description of a Claude API failure, plus whether it is worth
 * stopping the whole triage run (a bad key or model id fails every call).
 */
export function describeClaudeError(err: unknown): { message: string; fatal: boolean } {
  const status = (err as { status?: number })?.status;
  const raw = err instanceof Error ? err.message : String(err);
  if (status === 401 || /ANTHROPIC_API_KEY is not set/.test(raw)) {
    return { message: "Claude rejected the API key. Check ANTHROPIC_API_KEY in Vercel.", fatal: true };
  }
  if (status === 404 || (/model/i.test(raw) && /not.?found/i.test(raw))) {
    return {
      message: `Claude does not recognize the model id "${MODEL}". Set ANTHROPIC_MODEL in Vercel to a current Sonnet model id and redeploy.`,
      fatal: true,
    };
  }
  if (status === 429 || status === 529 || status === 503) {
    return { message: "Claude is rate limited or overloaded right now. The next sync retries.", fatal: true };
  }
  if (status === 400 && /credit|billing/i.test(raw)) {
    return { message: "The Anthropic account is out of credit. Add credit in the Anthropic console.", fatal: true };
  }
  return { message: `Claude call failed: ${raw.slice(0, 200)}`, fatal: false };
}

export const CLAUDE_MODEL = MODEL;
