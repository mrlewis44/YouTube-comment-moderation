import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CHANNELS, type ChannelKey } from "@/lib/domain";
import { fmtTime } from "@/lib/format";

// Per-channel YouTube authorization (SPEC Sections 2, 3). Admin only (Josh).
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  if (session.user.role !== "admin") redirect("/");

  const { status } = await searchParams;
  const connected = await connectedChannelIds();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-6 border-b border-line pb-5">
        <div className="text-sm font-medium uppercase tracking-wide text-ink-muted">
          Comment Copilot
        </div>
        <h1 className="text-2xl font-semibold text-ink">Connect channels</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Authorize each channel once. This grants comment read and moderation
          access. It is separate from app login, and the token is stored
          encrypted, never in the browser.
        </p>
      </header>

      <div className="mb-5 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm text-ink-muted">
        <p className="mb-1 font-medium text-ink">Before you connect</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            In Google&apos;s account picker, choose the account that owns the channel. For The Educated
            HomeBuyer that is the brand account, not your personal login. The app checks this and refuses a
            mismatch.
          </li>
          <li>
            Google will likely show a &quot;Google hasn&apos;t verified this app&quot; screen, because the
            youtube.force-ssl scope is not registered on the consent screen&apos;s Data Access page. As the
            project owner you can continue: click Advanced, then Go to the app. Registering the scope under
            Google Auth Platform, Data Access, removes the warning.
          </li>
          <li>
            The consent screen must stay In production. In Testing mode Google expires the connection after 7
            days and sync stops with an invalid_grant error; the queue then tells you to reconnect here.
          </li>
        </ul>
      </div>

      {status && (
        <div className="mb-4 rounded-btn border border-line bg-white px-4 py-2 text-sm text-ink">
          {formatStatus(status)}
        </div>
      )}

      <ul className="space-y-3">
        {(Object.keys(CHANNELS) as ChannelKey[]).map((key) => {
          const ch = CHANNELS[key];
          const info = connected.get(ch.platformChannelId);
          const isConnected = !!info;
          return (
            <li
              key={key}
              className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-white p-4"
            >
              <div>
                <div className="font-medium text-ink">{ch.displayName}</div>
                <div className="text-sm text-ink-muted">{ch.handle}</div>
                <div className="mt-1 text-xs text-ink-muted">
                  {isConnected
                    ? `Connected ${fmtTime(info.connectedAt)}${info.connectedBy ? ` by ${info.connectedBy}` : ""}`
                    : "Not connected"}
                </div>
                {info?.tokenError && (
                  <div className="mt-2 rounded-btn border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                    {info.tokenError}
                  </div>
                )}
              </div>
              <a
                href={`/api/youtube/connect?channel=${key}`}
                className={`shrink-0 rounded-btn px-4 py-2 text-sm font-medium ${
                  isConnected && !info?.tokenError
                    ? "border border-line bg-white text-ink-muted"
                    : "bg-ink text-white"
                }`}
              >
                {isConnected ? "Reconnect" : "Connect"}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-sm">
        <a href="/" className="text-ink-muted underline hover:text-ink">Back to the review queue</a>
      </p>
    </main>
  );
}

// Resilient: if the DB is not provisioned yet, show everything as unconnected
// rather than erroring the page.
type ConnectedInfo = { connectedAt: string | null; connectedBy: string | null; tokenError: string | null };

async function connectedChannelIds(): Promise<Map<string, ConnectedInfo>> {
  try {
    const { db, channels } = await import("@/db");
    const { isNotNull } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: channels.platformChannelId,
        connectedAt: channels.connectedAt,
        connectedBy: channels.connectedBy,
        tokenError: channels.tokenError,
      })
      .from(channels)
      .where(isNotNull(channels.oauthRefreshToken));
    return new Map(
      rows.map((r) => [
        r.id,
        { connectedAt: r.connectedAt?.toISOString() ?? null, connectedBy: r.connectedBy, tokenError: r.tokenError },
      ]),
    );
  } catch {
    return new Map();
  }
}

function formatStatus(status: string): string {
  if (status.startsWith("connected:")) {
    const rest = status.slice("connected:".length);
    const key = rest.split(" ")[0] as ChannelKey;
    const name = CHANNELS[key]?.displayName ?? key;
    return `Connected ${name}${rest.slice(key.length)}. Go back to the queue and hit Sync now.`;
  }
  if (status.startsWith("wrong account:")) return `Not saved: ${status.slice("wrong account:".length).trim()}`;
  if (status.startsWith("denied")) return `Google did not grant access (${status}). Nothing was saved.`;
  return `Connection status: ${status}`;
}
