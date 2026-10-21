import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildThreadContext,
  detectHiddenLinks,
  isAnsweredByHost,
  isHostComment,
  normalizeChannelUrl,
  partitionForIngest,
  threadsNeedingFullReplies,
  backlogCutoff,
} from "./ingest-core";
import type { RawComment, RawCommentThread } from "./youtube";

const HOST_ID = "UCbArQYdfPC2Dimq0LymXPYg";
const host = { channelIds: [HOST_ID, "UCvb_RkYOhXfCzeKLkCSEPTA"], urls: ["youtube.com/@theeducatedhomebuyer"] };
const noBlocked = { ids: new Set<string>(), urls: new Set<string>() };

function c(id: string, opts: Partial<RawComment> = {}): RawComment {
  return {
    id,
    videoId: "v1",
    authorDisplayName: `@viewer_${id}`,
    authorChannelUrl: `http://www.youtube.com/@viewer_${id}`,
    authorChannelId: `UCviewer_${id}`,
    text: `comment ${id}`,
    textHtml: null,
    likeCount: 0,
    publishedAt: "2026-10-01T00:00:00Z",
    parentId: null,
    ...opts,
  };
}
function thread(top: RawComment, replies: RawComment[] = []): RawCommentThread {
  return {
    threadId: top.id,
    topComment: top,
    replies: replies.map((r) => ({ ...r, parentId: top.id })),
    totalReplyCount: replies.length,
  };
}
const hostReply = (id: string, at: string) =>
  c(id, { authorChannelId: HOST_ID, authorChannelUrl: "http://www.youtube.com/@theeducatedhomebuyer", publishedAt: at });

test("host detection uses the channel id, and URL fallback is normalized", () => {
  assert.equal(isHostComment({ authorChannelId: HOST_ID, authorChannelUrl: null }, host), true);
  assert.equal(
    isHostComment({ authorChannelId: null, authorChannelUrl: "http://www.youtube.com/@TheEducatedHomeBuyer/" }, host),
    true,
  );
  assert.equal(isHostComment({ authorChannelId: "UCother", authorChannelUrl: "https://youtube.com/@other" }, host), false);
  assert.equal(normalizeChannelUrl("HTTPS://www.YouTube.com/@x/"), "@x");
});

test("a top comment with any host reply is answered", () => {
  const t = thread(c("a"), [hostReply("h", "2026-10-02T00:00:00Z")]);
  assert.equal(isAnsweredByHost(t.topComment, t, host), true);
});

test("a viewer reply posted after the host reply is still unanswered", () => {
  const late = c("late", { publishedAt: "2026-10-05T00:00:00Z", parentId: "a" });
  const early = c("early", { publishedAt: "2026-10-01T12:00:00Z", parentId: "a" });
  const t = thread(c("a"), [early, hostReply("h", "2026-10-02T00:00:00Z"), late]);
  assert.equal(isAnsweredByHost(early, t, host), true);
  assert.equal(isAnsweredByHost(late, t, host), false);
});

test("partition: new, resolved, blocked, duplicates, host comments", () => {
  const answered = thread(c("t1"), [c("r1", { publishedAt: "2026-10-01T06:00:00Z" }), hostReply("h1", "2026-10-02T00:00:00Z")]);
  const open = thread(c("t2"));
  const fromBlocked = thread(c("t3", { authorChannelId: "UCtroll" }));
  const stored = thread(c("t4"), [hostReply("h4", "2026-10-03T00:00:00Z")]);

  const res = partitionForIngest({
    threads: [answered, open, fromBlocked, stored],
    existingCommentIds: new Set(["t4"]),
    blocked: { ids: new Set(["UCtroll"]), urls: new Set() },
    host,
  });
  assert.deepEqual(res.toQueue.map((x) => x.id), ["t2"]);
  assert.deepEqual(res.toResolve.map((x) => x.id).sort(), ["r1", "t1"]);
  assert.deepEqual(res.toAutoHide.map((x) => x.id), ["t3"]);
  assert.deepEqual(res.answeredExistingIds, ["t4"]);
  assert.equal(res.skippedDuplicates, 1);
  assert.equal(res.hostComments, 2);
  assert.equal(res.toQueue[0].threadId, "t2");
});

test("blocked authors match by normalized URL when there is no channel id", () => {
  const t = thread(c("x", { authorChannelId: null, authorChannelUrl: "http://www.youtube.com/@Troll" }));
  const res = partitionForIngest({
    threads: [t],
    existingCommentIds: new Set(),
    blocked: { ids: new Set(), urls: new Set([normalizeChannelUrl("https://youtube.com/@troll")]) },
    host,
  });
  assert.equal(res.toAutoHide.length, 1);
});

test("non-blocked offenders are not auto-hidden (regression: old code treated every author row as blocked)", () => {
  const res = partitionForIngest({ threads: [thread(c("y"))], existingCommentIds: new Set(), blocked: noBlocked, host });
  assert.equal(res.toAutoHide.length, 0);
  assert.equal(res.toQueue.length, 1);
});

test("threads with more replies than inlined need a full fetch", () => {
  const t = thread(c("a"), [c("b")]);
  t.totalReplyCount = 9;
  assert.equal(threadsNeedingFullReplies([t, thread(c("z"))]).length, 1);
});

test("hidden link detection flags empty and disguised channel links, ignores timestamps and mentions", () => {
  assert.deepEqual(detectHiddenLinks("Great video"), []);
  assert.deepEqual(detectHiddenLinks(null), []);
  assert.equal(
    detectHiddenLinks('Henderson Nevada, 250,000, three hour drive to coast<a href="https://www.youtube.com/channel/UCabc"></a>').length,
    1,
  );
  assert.equal(detectHiddenLinks('see <a href="https://www.youtube.com/channel/UCabc">​</a>').length, 1);
  assert.equal(detectHiddenLinks('click <a href="http://www.youtube.com/@scammer">here</a>').length, 1);
  assert.deepEqual(detectHiddenLinks('at <a href="https://www.youtube.com/watch?v=abc&amp;t=123">2:03</a> you said'), []);
  assert.deepEqual(detectHiddenLinks('<a href="http://www.youtube.com/channel/UCjeb">@jebsmith</a> agreed'), []);
});

test("thread context lists the top comment first and excludes the target", () => {
  const ctx = buildThreadContext("r2", [
    { id: "t", author: "@a", text: "Mrs. Amanda changed my life, 5k to 62k", isTop: true },
    { id: "r1", author: "@b", text: "Is this the same Amanda?", isTop: false },
    { id: "r2", author: "@c", text: "She is the real deal", isTop: false },
  ]);
  assert.ok(ctx);
  assert.match(ctx!, /^\[top comment\] @a/);
  assert.doesNotMatch(ctx!, /real deal/);
  assert.equal(buildThreadContext("only", [{ id: "only", author: null, text: "x", isTop: true }]), undefined);
});

test("backlog cutoff defaults to 90 days", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  assert.equal(backlogCutoff(now).toISOString(), "2026-07-22T00:00:00.000Z");
});
