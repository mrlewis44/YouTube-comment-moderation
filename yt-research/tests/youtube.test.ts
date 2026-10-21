import { describe, expect, it } from "vitest";
import { QuotaMeter, TtlCache, YouTubeApiError, YouTubeClient } from "@/lib/youtube";
import { API_KEY, makeClient, mockFetch, page, video } from "./fixtures/builders";

describe("YouTubeClient", () => {
  it("caches identical requests and charges quota once", async () => {
    const { client, calls } = makeClient(() => page([video("vid00000001")]));
    const m1 = new QuotaMeter();
    await client.get("videos", { part: "snippet", id: "vid00000001" }, m1);
    const m2 = new QuotaMeter();
    await client.get("videos", { id: "vid00000001", part: "snippet" }, m2); // param order irrelevant
    expect(calls).toHaveLength(1);
    expect(m1.summary()).toMatchObject({ units_used: 1, cache_hits: 0 });
    expect(m2.summary()).toMatchObject({ units_used: 0, cache_hits: 1 });
  });

  it("expires cache entries after the TTL", async () => {
    let now = 0;
    const cache = new TtlCache(1000, 10, () => now);
    const { fetchImpl, calls } = mockFetch(() => page([]));
    const client = new YouTubeClient({ apiKey: API_KEY, fetch: fetchImpl, cache });
    await client.get("channels", { id: "x" }, new QuotaMeter());
    now = 1001;
    await client.get("channels", { id: "x" }, new QuotaMeter());
    expect(calls).toHaveLength(2);
  });

  it("evicts the oldest entry past maxEntries", () => {
    const cache = new TtlCache(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("counts search.list against the separate search bucket", async () => {
    const { client } = makeClient(() => page([]));
    const m = new QuotaMeter();
    await client.get("search", { q: "fha loans" }, m);
    expect(m.summary()).toMatchObject({ units_used: 0, search_calls_used: 1 });
  });

  it("never leaks the API key in errors, and adds a quota hint", async () => {
    const { client } = makeClient(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 403, message: `quota exceeded for key=${API_KEY}`, errors: [{ reason: "quotaExceeded" }] },
          }),
          { status: 403 },
        ),
    );
    const m = new QuotaMeter();
    const err = (await client.get("videos", { id: "x" }, m).catch((e: unknown) => e)) as YouTubeApiError;
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).toContain("quotaExceeded");
    expect(err.message).toContain("midnight Pacific");
    expect(m.summary().units_used).toBe(1); // failed calls still cost quota
  });

  it("refuses credential params and non-allowlisted endpoints", async () => {
    const { client } = makeClient(() => page([]));
    await expect(client.get("videos", { key: "x" }, new QuotaMeter())).rejects.toThrow(/Credentials/);
    // @ts-expect-error not an allowed endpoint
    await expect(client.get("captions", {}, new QuotaMeter())).rejects.toThrow(/not allowed/);
  });

  it("sends only GET requests with the key as a query param", async () => {
    const seen: RequestInit[] = [];
    const client = new YouTubeClient({
      apiKey: API_KEY,
      cache: new TtlCache(),
      fetch: async (_url, init) => {
        seen.push(init ?? {});
        return new Response(JSON.stringify(page([])), { status: 200 });
      },
    });
    await client.get("videos", { id: "a" }, new QuotaMeter());
    expect(seen[0].method).toBe("GET");
    expect(JSON.stringify(seen[0].headers ?? {})).not.toContain("Bearer");
  });

  it("requires an API key", () => {
    expect(() => new YouTubeClient({ apiKey: "" })).toThrow(/YOUTUBE_API_KEY/);
  });
});
