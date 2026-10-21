import { describe, expect, it } from "vitest";
import { getChannel, getChannelVideos, getVideos, searchVideos, summarizeVideo, withMedianBaseline } from "@/lib/tools";
import { OWNER, channel, makeClient, page, playlistItem, video } from "./fixtures/builders";

const NOW = new Date("2026-10-20T00:00:00Z");

describe("median baseline", () => {
  it("uses only long-form videos and computes ratios", () => {
    const vids = [
      video("long0000001", { views: 1000 }),
      video("long0000002", { views: 3000 }),
      video("long0000003", { views: 2000 }),
      video("long0000004", { views: 10000 }),
      video("short000001", { views: 500000, duration: "PT45S" }),
      video("short000002", { views: 90000, duration: "PT2M59S" }),
      video("live0000001", { views: 999999, live: "live", duration: "P0D" }),
      video("upcoming001", { views: 0, live: "upcoming", duration: "P0D" }),
    ].map((v) => summarizeVideo(v, NOW));
    const { baseline, videos } = withMedianBaseline(vids);
    // Long-form views: 1000, 2000, 3000, 10000 -> median 2500
    expect(baseline.long_form_count).toBe(4);
    expect(baseline.median_views_long_form).toBe(2500);
    const ratio = Object.fromEntries(videos.map((v) => [v.id, v.ratio_to_median]));
    expect(ratio.long0000001).toBe(0.4);
    expect(ratio.long0000004).toBe(4);
    expect(ratio.short000001).toBeNull();
    expect(ratio.live0000001).toBeNull();
    expect(videos.find((v) => v.id === "short000002")?.format).toBe("short");
  });

  it("treats exactly 3:01 as long-form and handles an odd count", () => {
    const vids = [
      video("a0000000001", { views: 100, duration: "PT3M1S" }),
      video("a0000000002", { views: 300 }),
      video("a0000000003", { views: 200 }),
    ].map((v) => summarizeVideo(v, NOW));
    expect(withMedianBaseline(vids).baseline.median_views_long_form).toBe(200);
  });

  it("returns a null baseline when there are no long-form videos", () => {
    const vids = [video("s0000000001", { duration: "PT30S" })].map((v) => summarizeVideo(v, NOW));
    const { baseline, videos } = withMedianBaseline(vids);
    expect(baseline.median_views_long_form).toBeNull();
    expect(videos[0].ratio_to_median).toBeNull();
  });
});

describe("summarizeVideo", () => {
  it("computes views per day and thumbnails", () => {
    const s = summarizeVideo(video("vid00000001", { views: 1000, publishedAt: "2026-10-10T00:00:00Z" }), NOW);
    expect(s.views_per_day).toBe(100);
    expect(s.thumbnail_maxres).toBe("https://i.ytimg.com/vi/vid00000001/maxresdefault.jpg");
    expect(s.thumbnail_high).toBe("https://i.ytimg.com/vi/vid00000001/hqdefault.jpg");
    expect(s.duration).toBe("12:30");
  });
  it("uses a 1-day floor for brand new videos", () => {
    const s = summarizeVideo(video("vid00000001", { views: 500, publishedAt: "2026-10-19T20:00:00Z" }), NOW);
    expect(s.views_per_day).toBe(500);
  });
  it("returns null likes when hidden", () => {
    const v = video("vid00000001");
    delete v.statistics!.likeCount;
    expect(summarizeVideo(v, NOW).likes).toBeNull();
  });
});

describe("get_videos", () => {
  it("batches 50 ids per videos.list call and reports missing ids", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${String(i).padStart(10, "0")}`);
    const { client, calls } = makeClient((_e, p) => {
      const req = (p.get("id") ?? "").split(",");
      return page(req.filter((id) => id !== ids[7]).map((id) => video(id)));
    });
    const res = await getVideos(client, { video_ids: [...ids, ids[0]] }, NOW);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.params.get("id")!.split(",").length)).toEqual([50, 50, 20]);
    expect(res.videos).toHaveLength(119);
    expect(res.not_found).toEqual([ids[7]]);
    expect(res.quota.units_used).toBe(3);
  });
});

describe("get_channel / get_channel_videos", () => {
  it("looks up by handle", async () => {
    const { client, calls } = makeClient(() => page([channel()]));
    const res = await getChannel(client, { channel: "@buyrightborrowsmart" });
    expect(calls[0].params.get("forHandle")).toBe("@buyrightborrowsmart");
    expect(res.channel.subscribers).toBe(25000);
    expect(res.channel.avg_views_per_video).toBe(2500);
    expect(res.channel.uploads_playlist_id).toBe(`UU${OWNER.slice(2)}`);
    expect(res.quota.units_used).toBe(1);
  });

  it("pages the uploads playlist, fetches stats, and adds the baseline", async () => {
    const all = Array.from({ length: 75 }, (_, i) => `u${String(i).padStart(10, "0")}`);
    const { client, calls } = makeClient((endpoint, p) => {
      if (endpoint === "channels") return page([channel()]);
      if (endpoint === "playlistItems") {
        expect(p.get("playlistId")).toBe(`UU${OWNER.slice(2)}`);
        return p.get("pageToken") === "N2"
          ? page(all.slice(50).map(playlistItem))
          : page(all.slice(0, 50).map(playlistItem), "N2");
      }
      if (endpoint === "videos") {
        return page(
          (p.get("id") ?? "").split(",").map((id) => video(id, { views: Number.parseInt(id.slice(1), 10) * 10 + 10 })),
        );
      }
    });
    const res = await getChannelVideos(client, { channel: OWNER, max: 60 }, NOW);
    expect(res.returned).toBe(60);
    expect(calls.filter((c) => c.endpoint === "playlistItems")).toHaveLength(2);
    expect(calls.filter((c) => c.endpoint === "videos").map((c) => c.params.get("id")!.split(",").length)).toEqual([
      50, 10,
    ]);
    // views 10..600 step 10 -> median of 60 values = (300 + 310) / 2
    expect(res.baseline.median_views_long_form).toBe(305);
    expect(res.videos[0].id).toBe(all[0]);
    // 1 channels + 2 playlistItems + 2 videos
    expect(res.quota.units_used).toBe(5);
  });
});

describe("search_videos", () => {
  it("uses the search bucket and enriches with stats", async () => {
    const { client, calls } = makeClient((endpoint, p) => {
      if (endpoint === "search") {
        expect(p.get("type")).toBe("video");
        expect(p.get("publishedAfter")).toBe("2026-01-01T00:00:00Z");
        return page([{ id: { kind: "youtube#video", videoId: "vid00000001" } }]);
      }
      if (endpoint === "videos") return page([video("vid00000001")]);
    });
    const res = await searchVideos(client, { query: "first time home buyer", published_after: "2026-01-01" }, NOW);
    expect(res.results).toHaveLength(1);
    expect(res.quota).toMatchObject({ units_used: 1, search_calls_used: 1 });
    expect(calls.map((c) => c.endpoint)).toEqual(["search", "videos"]);
  });
});
