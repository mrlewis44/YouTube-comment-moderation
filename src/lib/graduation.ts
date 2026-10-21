// Staged autonomy for delete_spam (SPEC Section 7). Pure so the rules are
// unit-tested; graduation-data.ts loads the decisions from the DB.
//
// delete_spam graduates to auto-run once, within the current trust window:
//   - at least 25 flagged instances have been human-reviewed,
//   - with zero overturned decisions,
//   - spanning at least two distinct spam signatures,
//   - and at least 7 days have passed since the window opened,
//     even if 25 instances resolve faster.
// Any overturn (a flagged comment marked "not spam", or a hidden comment
// restored) closes the window: the count starts over from that moment, so
// "zero overturned" always holds for the window that graduates. Post
// graduation, an overturn demotes delete_spam straight back to human review.
//
// delete_troll and respond never graduate; flag_political never graduates.

export const GRADUATION_REQUIRED_REVIEWS = 25;
export const GRADUATION_REQUIRED_SIGNATURES = 2;
export const GRADUATION_MIN_DAYS = 7;

/** Even when graduated, only auto-hide confident matches of a known signature. */
export const AUTO_HIDE_MIN_CONFIDENCE = 0.85;
export const KNOWN_SPAM_SIGNATURES = ["trading_testimonial", "hidden_link"] as const;
export const SPAM_SIGNATURES = [...KNOWN_SPAM_SIGNATURES, "other"] as const;
export type SpamSignature = (typeof SPAM_SIGNATURES)[number];

export const SPAM_SIGNATURE_LABELS: Record<SpamSignature, string> = {
  trading_testimonial: "Trading testimonial cluster",
  hidden_link: "Hidden link injection",
  other: "Other spam",
};

export type SpamDecision = {
  // When the human (or restore) decision happened.
  decidedAt: Date;
  // Confirmed = a human agreed it was spam and hid it.
  // Overturned = a human said it was not spam, or restored a hidden one.
  outcome: "confirmed" | "overturned";
  signature: string | null;
};

export type GraduationState = {
  status: "learning" | "graduated" | "paused";
  graduated: boolean; // criteria met (true even while paused)
  paused: boolean; // admin switch; auto-hide never runs while paused
  reviewed: number;
  required: number;
  signatures: string[];
  windowStart: Date | null;
  daysElapsed: number;
  lastOverturnAt: Date | null;
  // Plain-English list of what is still missing.
  missing: string[];
};

export function evaluateSpamGraduation(
  decisions: SpamDecision[],
  now: Date,
  opts: { paused?: boolean } = {},
): GraduationState {
  const sorted = [...decisions].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
  let lastOverturnAt: Date | null = null;
  for (const d of sorted) if (d.outcome === "overturned") lastOverturnAt = d.decidedAt;

  const window = sorted.filter(
    (d) => d.outcome === "confirmed" && (!lastOverturnAt || d.decidedAt.getTime() > lastOverturnAt.getTime()),
  );
  const signatures = [...new Set(window.map((d) => d.signature).filter((s): s is string => !!s))].sort();
  const windowStart = window[0]?.decidedAt ?? null;
  const daysElapsed = windowStart ? (now.getTime() - windowStart.getTime()) / 86_400_000 : 0;

  const missing: string[] = [];
  if (window.length < GRADUATION_REQUIRED_REVIEWS) {
    missing.push(`${GRADUATION_REQUIRED_REVIEWS - window.length} more human-reviewed spam decisions`);
  }
  if (signatures.length < GRADUATION_REQUIRED_SIGNATURES) {
    missing.push(
      `${GRADUATION_REQUIRED_SIGNATURES - signatures.length} more distinct spam signature${
        GRADUATION_REQUIRED_SIGNATURES - signatures.length === 1 ? "" : "s"
      }`,
    );
  }
  if (daysElapsed < GRADUATION_MIN_DAYS) {
    const left = Math.ceil(GRADUATION_MIN_DAYS - daysElapsed);
    missing.push(windowStart ? `${left} more day${left === 1 ? "" : "s"} of track record` : "a 7-day track record");
  }

  const graduated = missing.length === 0;
  return {
    status: graduated ? (opts.paused ? "paused" : "graduated") : "learning",
    graduated,
    paused: !!opts.paused,
    reviewed: window.length,
    required: GRADUATION_REQUIRED_REVIEWS,
    signatures,
    windowStart,
    daysElapsed,
    lastOverturnAt,
    missing,
  };
}

/** Should the system hide this freshly categorized comment without a human? */
export function shouldAutoHideSpam(
  review: { category: string; confidence: number; spamSignature: string | null },
  state: Pick<GraduationState, "status">,
): boolean {
  return (
    state.status === "graduated" &&
    review.category === "delete_spam" &&
    review.confidence >= AUTO_HIDE_MIN_CONFIDENCE &&
    (KNOWN_SPAM_SIGNATURES as readonly string[]).includes(review.spamSignature ?? "")
  );
}
