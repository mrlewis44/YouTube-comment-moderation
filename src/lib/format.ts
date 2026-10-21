// Deterministic date formatting (fixed Pacific time zone) so server and client
// render the same string and hydration never mismatches.

const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  return `${FMT.format(new Date(iso))} PT`;
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return DAY.format(new Date(iso));
}

/** "3 days ago" style, computed against a passed-in `now` for determinism. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hours ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function youtubeCommentUrl(videoId: string, commentId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
}
