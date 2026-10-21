import { test } from "node:test";
import assert from "node:assert/strict";
import { YouTubeApiError, classifyApiError, classifyTokenError, friendlyYouTubeError } from "./youtube-errors";

test("invalid_grant from the token endpoint becomes a reconnect message naming /connect and the consent screen", () => {
  const err = classifyTokenError(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  assert.equal(err.kind, "invalid_grant");
  assert.equal(err.needsReconnect, true);
  const msg = friendlyYouTubeError(err, "The Educated HomeBuyer");
  assert.match(msg, /\/connect/);
  assert.match(msg, /OAuth consent screen/);
  assert.match(msg, /Testing/);
  assert.match(msg, /7 days/);
  assert.match(msg, /In production/);
  assert.doesNotMatch(msg, /[—–]/);
});

test("bad client credentials are distinguished from an expired token", () => {
  assert.equal(classifyTokenError(401, { error: "invalid_client" }).kind, "oauth_client");
  assert.equal(classifyTokenError(500, null).kind, "other");
});

test("YouTube API errors classify by reason", () => {
  const body = (reason: string) => ({ error: { message: "x", errors: [{ reason }] } });
  assert.equal(classifyApiError(403, body("quotaExceeded"), "GET").kind, "quota");
  assert.equal(classifyApiError(403, body("forbidden"), "GET").kind, "forbidden");
  assert.equal(classifyApiError(403, body("commentsDisabled"), "GET").kind, "comments_disabled");
  assert.equal(classifyApiError(404, body("commentNotFound"), "GET").kind, "not_found");
  assert.equal(classifyApiError(401, body("authError"), "GET").kind, "invalid_grant");
  assert.equal(classifyApiError(400, body("banWithoutReject"), "POST").kind, "bad_request");
});

test("every friendly message is free of em dashes", () => {
  const kinds = ["not_connected", "invalid_grant", "oauth_client", "quota", "forbidden", "comments_disabled", "not_found", "bad_request", "network", "other"] as const;
  for (const k of kinds) {
    assert.doesNotMatch(friendlyYouTubeError(new YouTubeApiError(k, "m"), "TEHB"), /[—–]/);
  }
  assert.match(friendlyYouTubeError(new Error("boom"), "TEHB"), /boom/);
});
