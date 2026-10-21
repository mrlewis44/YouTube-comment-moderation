import { createHash, timingSafeEqual } from "node:crypto";

/** Tokens shorter than this are rejected as misconfiguration (fail closed). */
export const MIN_TOKEN_LENGTH = 32;

export type AuthResult =
  | { ok: true; via: "path" | "header" }
  | { ok: false; status: 401 | 404 | 503; message: string };

/**
 * Pulls the access token from either:
 *  - the path: /mcp/<token>  (for clients such as claude.ai custom connectors
 *    that cannot send custom headers), or
 *  - an `Authorization: Bearer <token>` header on /mcp.
 * Returns null when neither is present. Any other path shape is rejected.
 */
export function extractToken(request: Request): { token: string | null; via: "path" | "header" | null; badPath: boolean } {
  const { pathname } = new URL(request.url);
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "mcp" || parts.length > 2) return { token: null, via: null, badPath: true };
  if (parts.length === 2) {
    let token: string;
    try {
      token = decodeURIComponent(parts[1]);
    } catch {
      return { token: null, via: null, badPath: true };
    }
    return { token, via: "path", badPath: false };
  }
  const header = request.headers.get("authorization");
  const m = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  if (m) return { token: m[1].trim(), via: "header", badPath: false };
  return { token: null, via: null, badPath: false };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time comparison (hashing first makes lengths equal). */
export function tokensMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

export function checkAccess(request: Request, expectedToken: string | undefined): AuthResult {
  if (!expectedToken || expectedToken.length < MIN_TOKEN_LENGTH) {
    // Fail closed: never serve an unprotected endpoint.
    return {
      ok: false,
      status: 503,
      message: `Server not configured: MCP_ACCESS_TOKEN must be set to at least ${MIN_TOKEN_LENGTH} characters.`,
    };
  }
  const { token, via, badPath } = extractToken(request);
  if (badPath) return { ok: false, status: 404, message: "Not found." };
  if (!token || !via || !tokensMatch(token, expectedToken)) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }
  return { ok: true, via };
}

/** JSON error response that never echoes the presented token. */
export function denyResponse(result: Extract<AuthResult, { ok: false }>): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  if (result.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="yt-research"';
  return new Response(JSON.stringify({ error: result.message }), { status: result.status, headers });
}
