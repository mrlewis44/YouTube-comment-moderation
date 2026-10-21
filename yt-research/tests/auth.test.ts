import { describe, expect, it } from "vitest";
import { MIN_TOKEN_LENGTH, checkAccess, denyResponse, extractToken, tokensMatch } from "@/lib/auth";

const TOKEN = "t".repeat(20) + "0123456789abcdef"; // 36 chars
const BASE = "https://yt-research.example.vercel.app";

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: "POST", headers });

describe("auth", () => {
  it("accepts the token as a path segment", () => {
    expect(checkAccess(req(`/mcp/${TOKEN}`), TOKEN)).toEqual({ ok: true, via: "path" });
    expect(checkAccess(req(`/mcp/${TOKEN}/`), TOKEN)).toEqual({ ok: true, via: "path" });
  });

  it("accepts a Bearer header on /mcp", () => {
    expect(checkAccess(req("/mcp", { Authorization: `Bearer ${TOKEN}` }), TOKEN)).toEqual({ ok: true, via: "header" });
    expect(checkAccess(req("/mcp", { authorization: `bearer ${TOKEN}` }), TOKEN)).toMatchObject({ ok: true });
  });

  it("rejects a missing or wrong token with 401", () => {
    expect(checkAccess(req("/mcp"), TOKEN)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(req("/mcp/wrong-token"), TOKEN)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(req("/mcp", { Authorization: "Bearer nope" }), TOKEN)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(req(`/mcp/${TOKEN}x`), TOKEN)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(req(`/mcp/${TOKEN.slice(0, -1)}`), TOKEN)).toMatchObject({ ok: false, status: 401 });
  });

  it("does not let a header rescue a wrong path token", () => {
    expect(checkAccess(req("/mcp/wrong", { Authorization: `Bearer ${TOKEN}` }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("returns 404 for unexpected paths", () => {
    expect(checkAccess(req(`/mcp/${TOKEN}/extra`), TOKEN)).toMatchObject({ ok: false, status: 404 });
    expect(checkAccess(req(`/other/${TOKEN}`), TOKEN)).toMatchObject({ ok: false, status: 404 });
  });

  it("fails closed when MCP_ACCESS_TOKEN is unset or too short", () => {
    expect(checkAccess(req(`/mcp/${TOKEN}`), undefined)).toMatchObject({ ok: false, status: 503 });
    expect(checkAccess(req("/mcp/short"), "short")).toMatchObject({ ok: false, status: 503 });
    expect(checkAccess(req("/mcp/"), "")).toMatchObject({ ok: false, status: 503 });
    expect(MIN_TOKEN_LENGTH).toBeGreaterThanOrEqual(32);
  });

  it("decodes URL-encoded path tokens", () => {
    const special = "abc+def/ghi=jkl".padEnd(40, "z");
    expect(extractToken(req(`/mcp/${encodeURIComponent(special)}`)).token).toBe(special);
    expect(checkAccess(req(`/mcp/${encodeURIComponent(special)}`), special)).toMatchObject({ ok: true });
  });

  it("compares in constant time regardless of length", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch("a", TOKEN)).toBe(false);
  });

  it("never echoes the presented token in the denial body", async () => {
    const result = checkAccess(req("/mcp/some-guess-token-value"), TOKEN);
    if (result.ok) throw new Error("expected denial");
    const res = denyResponse(result);
    const body = await res.text();
    expect(res.status).toBe(401);
    expect(body).not.toContain("some-guess-token-value");
    expect(body).not.toContain(TOKEN);
  });
});
