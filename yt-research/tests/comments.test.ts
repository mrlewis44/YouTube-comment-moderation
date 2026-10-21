import { describe, expect, it } from "vitest";
import { getComments, getUnansweredComments, ownerReplyStatus } from "@/lib/tools";
import recorded from "./fixtures/commentThreads.recorded.json";
import {
  OWNER,
  makeClient,
  ownerReply,
  page,
  thread,
  video,
  viewerReply,
} from "./fixtures/builders";

const NOW = new Date("2026-10-20T00:00:00Z");

describe("ownerReplyStatus", () => {
  it("is true when an embedded reply is from the owner", () => {
    expect(ownerReplyStatus(3, [viewerReply("r1", "t"), ownerReply("r2", "t")], OWNER)).toBe(true);
  });
  it("is false when there are no replies", () => {
    expect(ownerReplyStatus(0, [], OWNER)).toBe(false);
  });
  it("is false when every reply is present and none is the owner's", () => {
    expect(ownerReplyStatus(2, [viewerReply("r1", "t"), viewerReply("r2", "t")], OWNER)).toBe(false);
  });
  it("is null (unknown) when replies are truncated and no owner reply is visible", () => {
    expect(ownerReplyStatus(7, [viewerReply("r1", "t")], OWNER)).toBeNull();
  });
  it("is null without an owner id", () => {
    expect(ownerReplyStatus(0, [], null)).toBeNull();
  });
});

describe("get_comments", () => {
  it("paginates commentThreads.list 100 at a time and stops at max_comments", async () => {
    const pages: Record<string, ReturnType<typeof page>> = {
      "": page(Array.from({ length: 100 }, (_, i) => thread(`a${i}`)), "P2"),
      P2: page(Array.from({ length: 100 }, (_, i) => thread(`b${i}`)), "P3"),
      P3: page(Array.from({ length: 100 }, (_, i) => thread(`c${i}`)), "P4"),
      P4: page(Array.from({ length: 100 }, (_, i) => thread(`d${i}`))),
    };
    const { client, calls } = makeClient((endpoint, p) => {
      if (endpoint === "videos") return page([video("vid00000001")]);
      if (endpoint === "commentThreads") return pages[p.get("pageToken") ?? ""];
    });
    const res = await getComments(client, { video_id: "vid00000001", max_comments: 250 }, NOW);

    const threadCalls = calls.filter((c) => c.endpoint === "commentThreads");
    expect(threadCalls).toHaveLength(3);
    expect(threadCalls.map((c) => c.params.get("pageToken"))).toEqual([null, "P2", "P3"]);
    expect(threadCalls.every((c) => c.params.get("maxResults") === "100")).toBe(true);
    expect(threadCalls.every((c) => c.params.get("order") === "relevance")).toBe(true);
    expect(res.returned).toBe(250);
    expect(res.pages_fetched).toBe(3);
    expect(res.has_more).toBe(true);
    expect(res.comments[0].id).toBe("a0");
    expect(res.comments[249].id).toBe("c49");
    // 1 videos.list + 3 commentThreads.list
    expect(res.quota.units_used).toBe(4);
  });

  it("stops when there is no nextPageToken", async () => {
    const { client, calls } = makeClient((endpoint) => {
      if (endpoint === "videos") return page([video("vid00000001")]);
      return page([thread("only")]);
    });
    const res = await getComments(client, { video_id: "vid00000001", max_comments: 1000, order: "time" }, NOW);
    expect(calls.filter((c) => c.endpoint === "commentThreads")).toHaveLength(1);
    expect(calls[1].params.get("order")).toBe("time");
    expect(res.has_more).toBe(false);
  });

  it("detects owner replies on a recorded API page, and resolves hidden replies via comments.list", async () => {
    const { client, calls } = makeClient((endpoint, p) => {
      if (endpoint === "videos") return page([video("dQw4w9WgXcQ")]);
      if (endpoint === "commentThreads") return { ...recorded, nextPageToken: undefined };
      if (endpoint === "comments" && p.get("parentId") === "UgxTHREAD_busy") {
        // Full list: 6 viewer replies + the owner's reply that the embedded 5 did not show.
        return page([
          ...Array.from({ length: 6 }, (_, i) => viewerReply(`UgxTHREAD_busy.R${i + 1}`, "UgxTHREAD_busy")),
          ownerReply("UgxTHREAD_busy.R7", "UgxTHREAD_busy", "2026-10-14T00:00:00Z"),
        ]);
      }
    });
    const res = await getComments(client, { video_id: "dQw4w9WgXcQ" }, NOW);
    const byId = Object.fromEntries(res.comments.map((c) => [c.id, c]));
    expect(byId.UgxTHREAD_answered.owner_replied).toBe(true);
    expect(byId.UgxTHREAD_unanswered.owner_replied).toBe(false);
    expect(byId.UgxTHREAD_unanswered.edited).toBe(true);
    expect(byId.UgxTHREAD_busy.owner_replied).toBe(true);
    expect(byId.UgxTHREAD_busy.reply_count).toBe(7);
    expect(byId.UgxTHREAD_answered.text).toBe("Should I buy points or put more down?");
    expect(byId.UgxTHREAD_answered.likes).toBe(12);
    expect(res.owner_replied_threads).toBe(2);
    expect(res.owner_reply_unknown_threads).toBe(0);
    // Only the truncated thread needed a comments.list call.
    expect(calls.filter((c) => c.endpoint === "comments").map((c) => c.params.get("parentId"))).toEqual(["UgxTHREAD_busy"]);
    expect(res.quota.units_used).toBe(3);
  });

  it("leaves owner_replied null when the reply-fetch budget is spent", async () => {
    const { client, calls } = makeClient((endpoint) => {
      if (endpoint === "videos") return page([video("vid00000001")]);
      if (endpoint === "commentThreads") return page([thread("t1", { total: 9, replies: [viewerReply("r1", "t1")] })]);
    });
    const res = await getComments(client, { video_id: "vid00000001", max_reply_fetches: 0 }, NOW);
    expect(res.comments[0].owner_replied).toBeNull();
    expect(res.owner_reply_unknown_threads).toBe(1);
    expect(calls.some((c) => c.endpoint === "comments")).toBe(false);
  });

  it("include_replies returns replies oldest first and flags the owner's", async () => {
    const { client } = makeClient((endpoint) => {
      if (endpoint === "videos") return page([video("vid00000001")]);
      return page([
        thread("t1", {
          replies: [ownerReply("r2", "t1", "2026-10-03T00:00:00Z"), viewerReply("r1", "t1", "2026-10-02T00:00:00Z")],
        }),
      ]);
    });
    const res = await getComments(client, { video_id: "vid00000001", include_replies: true }, NOW);
    const c = res.comments[0] as (typeof res.comments)[number] & { replies: { id: string; by_owner?: true }[] };
    expect(c.replies.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(c.replies[1].by_owner).toBe(true);
    expect(c.replies[0].by_owner).toBeUndefined();
  });

  it("errors clearly when the video does not exist", async () => {
    const { client } = makeClient(() => page([]));
    await expect(getComments(client, { video_id: "vid00000001" }, NOW)).rejects.toThrow(/not found/);
  });
});

describe("get_unanswered_comments", () => {
  it("returns comments with no owner reply, newest first, within the window", async () => {
    const pages: Record<string, ReturnType<typeof page>> = {
      "": page(
        [
          thread("new-answered", { publishedAt: "2026-10-19T00:00:00Z", replies: [ownerReply("x", "new-answered")] }),
          thread("new-unanswered", { publishedAt: "2026-10-18T00:00:00Z", videoId: "vidAAAAAAAA" }),
          thread("owner-own-comment", { publishedAt: "2026-10-17T00:00:00Z", authorId: OWNER }),
          thread("hidden-owner-reply", {
            publishedAt: "2026-10-16T00:00:00Z",
            total: 8,
            replies: [viewerReply("h1", "hidden-owner-reply")],
          }),
        ],
        "P2",
      ),
      P2: page(
        [
          thread("older-unanswered", {
            publishedAt: "2026-08-01T00:00:00Z",
            videoId: "vidBBBBBBBB",
            replies: [viewerReply("v1", "older-unanswered")],
          }),
          thread("outside-window", { publishedAt: "2026-06-01T00:00:00Z" }),
          thread("also-outside", { publishedAt: "2026-05-01T00:00:00Z" }),
        ],
        "P3",
      ),
    };
    const { client, calls } = makeClient((endpoint, p) => {
      if (endpoint === "commentThreads") return pages[p.get("pageToken") ?? ""];
      if (endpoint === "comments") return page([viewerReply("h1", "x"), ownerReply("h2", "x")]);
      if (endpoint === "videos") {
        return page((p.get("id") ?? "").split(",").map((id) => video(id, { title: `Title ${id}` })));
      }
    });

    const res = await getUnansweredComments(client, { channel: OWNER, days: 90 }, NOW);

    expect(res.unanswered.map((c) => c.id)).toEqual(["new-unanswered", "older-unanswered"]);
    expect(res.unanswered[0].video_title).toBe("Title vidAAAAAAAA");
    expect(res.unanswered[0].url).toBe("https://www.youtube.com/watch?v=vidAAAAAAAA&lc=new-unanswered");
    expect(res.scan_complete).toBe(true);
    expect(res.unverified_count).toBeUndefined();

    const threadCalls = calls.filter((c) => c.endpoint === "commentThreads");
    expect(threadCalls).toHaveLength(2); // stopped at the cutoff, never requested P3
    expect(threadCalls[0].params.get("allThreadsRelatedToChannelId")).toBe(OWNER);
    expect(threadCalls[0].params.get("order")).toBe("time");
    // UC id resolves for free: 2 commentThreads + 1 comments + 1 videos
    expect(calls.some((c) => c.endpoint === "channels")).toBe(false);
    expect(res.quota.units_used).toBe(4);
  });

  it("reports threads it could not verify instead of guessing", async () => {
    const { client } = makeClient((endpoint) => {
      if (endpoint === "commentThreads") {
        return page([
          thread("busy", { publishedAt: "2026-10-18T00:00:00Z", total: 20, replies: [viewerReply("r", "busy")] }),
        ]);
      }
      if (endpoint === "videos") return page([video("vid00000001")]);
    });
    const res = await getUnansweredComments(client, { channel: OWNER, max_reply_checks: 0 }, NOW);
    expect(res.unanswered_count).toBe(0);
    expect(res.unverified_count).toBe(1);
  });

  it("resolves an @handle with one channels.list call and flags an incomplete scan", async () => {
    const { client, calls } = makeClient((endpoint, p) => {
      if (endpoint === "channels") {
        expect(p.get("forHandle")).toBe("@buyrightborrowsmart");
        return page([{ id: OWNER }]);
      }
      if (endpoint === "commentThreads") return page([thread("t", { publishedAt: "2026-10-18T00:00:00Z" })], "MORE");
      if (endpoint === "videos") return page([video("vid00000001")]);
    });
    const res = await getUnansweredComments(client, { channel: "@buyrightborrowsmart", max_pages: 1 }, NOW);
    expect(res.channel_id).toBe(OWNER);
    expect(res.scan_complete).toBe(false);
    expect(res.scan_note).toMatch(/max_pages=1/);
    expect(calls.filter((c) => c.endpoint === "channels")).toHaveLength(1);
  });
});
