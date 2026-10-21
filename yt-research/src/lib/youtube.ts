/**
 * Minimal, read-only YouTube Data API v3 client.
 *
 * - Only GET requests to an allowlist of read endpoints. There is no code path
 *   that can call insert/update/delete/setModerationStatus or use OAuth.
 * - Auth is an API key only (no OAuth channel tokens).
 * - The API key is never placed in errors, logs, cache keys, or tool output.
 */

export const API_BASE = "https://www.googleapis.com/youtube/v3";

/** Read-only endpoints this server is allowed to call, with their quota cost. */
export const ENDPOINTS = {
  commentThreads: { units: 1, bucket: "main" },
  comments: { units: 1, bucket: "main" },
  videos: { units: 1, bucket: "main" },
  channels: { units: 1, bucket: "main" },
  playlistItems: { units: 1, bucket: "main" },
  search: { units: 1, bucket: "search" },
} as const;

export type Endpoint = keyof typeof ENDPOINTS;
export type Params = Record<string, string | number | boolean | undefined | null>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Tracks what one tool call cost, so every result can report it. */
export class QuotaMeter {
  units = 0;
  searchCalls = 0;
  apiCalls = 0;
  cacheHits = 0;

  record(endpoint: Endpoint) {
    const cost = ENDPOINTS[endpoint];
    this.apiCalls += 1;
    if (cost.bucket === "search") this.searchCalls += cost.units;
    else this.units += cost.units;
  }

  summary() {
    return {
      units_used: this.units,
      search_calls_used: this.searchCalls,
      api_calls: this.apiCalls,
      cache_hits: this.cacheHits,
    };
  }
}

/** Small TTL + max-size cache. Lives for the life of a warm serverless instance. */
export class TtlCache {
  private store = new Map<string, { expires: number; value: unknown }>();
  constructor(
    private ttlMs = 10 * 60 * 1000,
    private maxEntries = 500,
    private now: () => number = Date.now,
  ) {}

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value as T;
  }

  set(key: string, value: unknown) {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { expires: this.now() + this.ttlMs, value });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export interface YouTubeClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  cache?: TtlCache;
  baseUrl?: string;
}

/** Shared across requests on a warm instance. */
export const sharedCache = new TtlCache();

export class YouTubeClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly cache: TtlCache;
  private readonly baseUrl: string;

  constructor(opts: YouTubeClientOptions) {
    if (!opts.apiKey) throw new Error("YOUTUBE_API_KEY is not set on the server.");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
    this.cache = opts.cache ?? sharedCache;
    this.baseUrl = opts.baseUrl ?? API_BASE;
  }

  /** GET a read-only endpoint. Results are cached by endpoint + params (never the key). */
  async get<T>(endpoint: Endpoint, params: Params, meter: QuotaMeter): Promise<T> {
    if (!Object.prototype.hasOwnProperty.call(ENDPOINTS, endpoint)) {
      throw new Error(`Endpoint not allowed: ${String(endpoint)}`);
    }
    const clean: [string, string][] = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)] as [string, string])
      .sort(([a], [b]) => a.localeCompare(b));
    if (clean.some(([k]) => k.toLowerCase() === "key" || k.toLowerCase() === "access_token")) {
      throw new Error("Credentials may not be passed as parameters.");
    }
    const query = new URLSearchParams(clean).toString();
    const cacheKey = `${endpoint}?${query}`;

    const cached = this.cache.get<T>(cacheKey);
    if (cached !== undefined) {
      meter.cacheHits += 1;
      return cached;
    }

    const url = `${this.baseUrl}/${endpoint}?${query}&key=${encodeURIComponent(this.apiKey)}`;
    // Failed requests still cost quota, so record before the call.
    meter.record(endpoint);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
    } catch (err) {
      throw new YouTubeApiError(
        `Network error calling YouTube ${endpoint}.list: ${this.redact(String((err as Error)?.message ?? err))}`,
        0,
        null,
      );
    }

    const body = (await res.json().catch(() => null)) as
      | { error?: { code?: number; message?: string; errors?: { reason?: string }[] } }
      | null;

    if (!res.ok || !body || body.error) {
      const reason = body?.error?.errors?.[0]?.reason ?? null;
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      throw new YouTubeApiError(
        `YouTube ${endpoint}.list failed (${res.status}${reason ? `, ${reason}` : ""}): ${this.redact(msg)}${hintFor(reason)}`,
        res.status,
        reason,
      );
    }

    this.cache.set(cacheKey, body);
    return body as T;
  }

  private redact(text: string): string {
    return text.split(this.apiKey).join("[redacted]");
  }
}

function hintFor(reason: string | null): string {
  switch (reason) {
    case "quotaExceeded":
    case "dailyLimitExceeded":
      return " Daily quota is used up (shared with Comment Copilot). It resets at midnight Pacific time.";
    case "commentsDisabled":
      return " Comments are disabled on this video.";
    case "keyInvalid":
    case "API_KEY_INVALID":
      return " The server's YOUTUBE_API_KEY is invalid.";
    case "accessNotConfigured":
      return " YouTube Data API v3 is not enabled for the key's Google Cloud project.";
    default:
      return "";
  }
}
