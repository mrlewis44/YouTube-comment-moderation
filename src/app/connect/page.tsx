import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CHANNELS, type ChannelKey } from "@/lib/domain";

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

      {status && (
        <div className="mb-4 rounded-btn border border-line bg-white px-4 py-2 text-sm text-ink">
          {formatStatus(status)}
        </div>
      )}

      <ul className="space-y-3">
        {(Object.keys(CHANNELS) as ChannelKey[]).map((key) => {
          const ch = CHANNELS[key];
          const isConnected = connected.has(ch.platformChannelId);
          return (
            <li
              key={key}
              className="flex items-center justify-between rounded-2xl border border-line bg-white p-4"
            >
              <div>
                <div className="font-medium text-ink">{ch.displayName}</div>
                <div className="text-sm text-ink-muted">{ch.handle}</div>
              </div>
              <a
                href={`/api/youtube/connect?channel=${key}`}
                className={`rounded-btn px-4 py-2 text-sm font-medium ${
                  isConnected
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
    </main>
  );
}

// Resilient: if the DB is not provisioned yet, show everything as unconnected
// rather than erroring the page.
async function connectedChannelIds(): Promise<Set<string>> {
  try {
    const { db, channels } = await import("@/db");
    const { isNotNull } = await import("drizzle-orm");
    const rows = await db
      .select({ id: channels.platformChannelId })
      .from(channels)
      .where(isNotNull(channels.oauthRefreshToken));
    return new Set(rows.map((r) => r.id));
  } catch {
    return new Set();
  }
}

function formatStatus(status: string): string {
  if (status.startsWith("connected:")) return `Connected ${status.split(":")[1]}.`;
  return `Connection status: ${status}`;
}
