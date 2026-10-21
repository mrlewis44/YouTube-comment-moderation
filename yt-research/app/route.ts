export const dynamic = "force-static";

/** Public landing response. Reveals nothing about configuration. */
export function GET() {
  return new Response("yt-research: read-only YouTube research MCP server. The MCP endpoint requires an access token.\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
