/**
 * End-to-end through the real Next.js route module and mcp-handler:
 * auth gate -> MCP JSON-RPC -> tool -> mocked YouTube fetch.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sharedCache } from "@/lib/youtube";
import { API_KEY, page, video } from "./fixtures/builders";

const TOKEN = "e2e-test-token-0123456789-abcdefghijklmnop";
const BASE = "https://yt-research.example.vercel.app";
const fetchCalls: string[] = [];

beforeAll(() => {
  vi.stubEnv("MCP_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("YOUTUBE_API_KEY", API_KEY);
  vi.stubGlobal("fetch", async (url: string) => {
    fetchCalls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/videos")) {
      return new Response(JSON.stringify(page([video("dQw4w9WgXcQ", { views: 4200 })])), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { code: 404, message: "unmocked" } }), { status: 404 });
  });
  sharedCache.clear();
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function rpc(path: string, body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("../app/mcp/[[...token]]/route");
  const res = await POST(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  // Streamable HTTP may answer as SSE; pull the JSON-RPC message out of the data lines.
  const json = text.trim().startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(
        text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join(""),
      );
  return { status: res.status, json, text };
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1" } },
};

describe("MCP route", () => {
  it("rejects requests without the token before touching MCP", async () => {
    const { status, text } = await rpc("/mcp", initialize);
    expect(status).toBe(401);
    expect(text).not.toContain(TOKEN);
  });

  it("initializes with the path token", async () => {
    const { status, json } = await rpc(`/mcp/${TOKEN}`, initialize);
    expect(status).toBe(200);
    expect(json.result.serverInfo.name).toBe("yt-research");
  });

  it("lists all tools, all annotated read-only", async () => {
    const { json } = await rpc(`/mcp/${TOKEN}`, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = json.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "get_channel",
      "get_channel_videos",
      "get_comments",
      "get_unanswered_comments",
      "get_videos",
      "quota_note",
      "search_videos",
    ]);
    for (const t of json.result.tools) expect(t.annotations?.readOnlyHint).toBe(true);
    const search = json.result.tools.find((t: { name: string }) => t.name === "search_videos");
    expect(search.description).toMatch(/100 calls per day/);
  });

  it("calls get_videos with a Bearer header and reports quota", async () => {
    const { json } = await rpc(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_videos", arguments: { video_ids: ["https://youtu.be/dQw4w9WgXcQ"] } },
      },
      { Authorization: `Bearer ${TOKEN}` },
    );
    expect(json.result.isError).toBeFalsy();
    const data = JSON.parse(json.result.content[0].text);
    expect(data.videos[0]).toMatchObject({ id: "dQw4w9WgXcQ", views: 4200 });
    expect(data.quota.units_used).toBe(1);
    expect(fetchCalls.at(-1)).toContain("googleapis.com/youtube/v3/videos");
  });

  it("surfaces YouTube errors as tool errors without the API key", async () => {
    const { json } = await rpc(`/mcp/${TOKEN}`, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_channel", arguments: { channel: "@nobody" } },
    });
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).not.toContain(API_KEY);
  });
});
