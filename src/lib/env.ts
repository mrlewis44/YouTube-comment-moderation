// Environment access, mirrors tehb-website's server/_core/env.ts pattern:
// the app login allowlist is a comma-separated, trimmed, lowercased list.
// See SPEC.md Section 9 for the full env var list.

function list(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const ENV = {
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  nextAuthSecret: process.env.NEXTAUTH_SECRET ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  databaseUrl: process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  // Google Chat incoming-webhook URL for high-priority opportunity pings
  // (SPEC Section 8a). Optional: if unset, notifications are skipped silently.
  googleChatWebhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL ?? "",
  // Public base URL, used to build the YouTube OAuth callback redirect.
  appUrl: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  // Shared secret protecting the cron ingest endpoint (SPEC Section 8, cadence).
  cronSecret: process.env.CRON_SECRET ?? "",
  // App-level login allowlist (SPEC Section 3). Separate from YouTube API auth.
  allowedEmails: list(process.env.ALLOWED_EMAILS),
  isProduction: process.env.NODE_ENV === "production",
};

/** Redirect URI registered with the OAuth client for the YouTube connect flow. */
export function youtubeRedirectUri(): string {
  return `${ENV.appUrl.replace(/\/$/, "")}/api/youtube/callback`;
}

/** The scope that lets the app read and moderate comments (SPEC Section 3). */
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ENV.allowedEmails.includes(email.toLowerCase());
}
