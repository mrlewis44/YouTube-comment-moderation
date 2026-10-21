/** Small pure helpers. No network, no env access, so they are easy to test. */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^@[A-Za-z0-9._-]{3,100}$/;

/**
 * Accepts a bare 11-character video ID or a common YouTube URL
 * (watch?v=, youtu.be/, /shorts/, /live/, /embed/) and returns the ID.
 */
export function normalizeVideoId(input: string): string {
  const raw = input.trim();
  if (VIDEO_ID_RE.test(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Not a YouTube video ID or URL: ${raw}`);
  }
  const v = url.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname.endsWith("youtu.be") && parts[0] && VIDEO_ID_RE.test(parts[0])) {
    return parts[0];
  }
  const marker = parts.findIndex((p) => ["shorts", "live", "embed", "v"].includes(p));
  if (marker >= 0 && parts[marker + 1] && VIDEO_ID_RE.test(parts[marker + 1])) {
    return parts[marker + 1];
  }
  throw new Error(`Not a YouTube video ID or URL: ${raw}`);
}

export type ChannelRef = { kind: "id"; value: string } | { kind: "handle"; value: string };

/**
 * Accepts a UC... channel ID, an @handle, or a channel URL
 * (youtube.com/channel/UC..., youtube.com/@handle).
 */
export function parseChannelRef(input: string): ChannelRef {
  const raw = input.trim();
  if (CHANNEL_ID_RE.test(raw)) return { kind: "id", value: raw };
  if (HANDLE_RE.test(raw)) return { kind: "handle", value: raw };
  if (/^[A-Za-z0-9._-]{3,100}$/.test(raw)) {
    // Bare handle without the @.
    return { kind: "handle", value: `@${raw}` };
  }
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1] && CHANNEL_ID_RE.test(parts[1])) {
      return { kind: "id", value: parts[1] };
    }
    if (parts[0] && HANDLE_RE.test(decodeURIComponent(parts[0]))) {
      return { kind: "handle", value: decodeURIComponent(parts[0]) };
    }
  } catch {
    // fall through
  }
  throw new Error(`Not a channel ID (UC...), @handle, or channel URL: ${raw}`);
}

/** Parses an ISO 8601 duration such as PT1H2M3S or P1DT2H into seconds. */
export function parseIsoDuration(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Math.round(Number(s ?? 0))
  );
}

/** Formats seconds as H:MM:SS or M:SS. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Median of a list of numbers; null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Whole and fractional days between an ISO timestamp and now, minimum 1 day. */
export function daysSince(iso: string, now: Date): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(1, ms / 86_400_000);
}

/** YouTube statistics are strings; hidden counts are absent. */
export function toInt(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Accepts YYYY-MM-DD or a full RFC 3339 timestamp and returns RFC 3339 (UTC). */
export function toRfc3339(input: string): string {
  const raw = input.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a valid date: ${raw}`);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Keeps very long comments from blowing up the context window. */
export function truncateText(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}... [truncated, ${text.length} chars]` : text;
}
