import { createMcpHandler } from "mcp-handler";
import { checkAccess, denyResponse } from "@/lib/auth";
import { SERVER_INFO, SERVER_INSTRUCTIONS, registerTools } from "@/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcpHandler = createMcpHandler((server) => registerTools(server), {
  serverInfo: SERVER_INFO,
  instructions: SERVER_INSTRUCTIONS,
  // Logs could include request details; keep them off.
  verboseLogs: false,
});

/**
 * Serves MCP over Streamable HTTP at:
 *   /mcp/<MCP_ACCESS_TOKEN>                    (claude.ai custom connector)
 *   /mcp  + Authorization: Bearer <token>       (clients that can send headers)
 */
async function handle(request: Request): Promise<Response> {
  const auth = checkAccess(request, process.env.MCP_ACCESS_TOKEN);
  if (!auth.ok) return denyResponse(auth);
  return mcpHandler(request);
}

export { handle as GET, handle as POST, handle as DELETE };
