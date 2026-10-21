import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { CHANNELS, type ChannelKey } from "@/lib/domain";
import { MOCK_COMMENTS } from "@/lib/mock";
import { loadQueue } from "@/lib/queue-data";
import { loadActivity, loadAuthors, loadChannelHealth } from "@/lib/dashboard-data";
import { ReviewQueue } from "@/components/ReviewQueue";
import { SyncButton } from "@/components/SyncButton";
import { ChannelHealthPanel } from "@/components/ChannelHealthPanel";
import { ActivityList } from "@/components/ActivityList";
import { AutopilotPanel, type AutopilotView } from "@/components/AutopilotPanel";
import { AuthorsPanel } from "@/components/AuthorsPanel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "queue", label: "Queue" },
  { key: "auto", label: "Auto-actioned" },
  { key: "authors", label: "Authors" },
  { key: "activity", label: "Activity log" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function Home({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { email, role, channels } = session.user;
  const isAdmin = role === "admin";
  const accessible = new Set<ChannelKey>(channels);
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.key === tabParam)?.key ?? "queue") as Tab;
  const now = Date.now();

  const [queue, health] = await Promise.all([loadQueue(channels), loadChannelHealth(channels)]);

  // Samples only before anything is live: no database, or no channel connected
  // and nothing stored. An empty live queue stays empty (everything handled).
  const anyConnected = health?.some((h) => h.connected) ?? false;
  const anyStored = health?.some((h) => h.stored90d > 0) ?? false;
  const usingSamples = !queue.dbOk || (!anyConnected && !anyStored && queue.items.length === 0);
  const visible = usingSamples ? MOCK_COMMENTS.filter((c) => accessible.has(c.channel)) : queue.items;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="text-sm font-medium uppercase tracking-wide text-ink-muted">Comment Copilot</div>
          <h1 className="text-2xl font-semibold text-ink">Review queue</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {channels.map((c) => CHANNELS[c].displayName).join(" and ")}
            {" · "}
            {email} ({role})
          </p>
        </div>
        <div className="flex items-start gap-2">
          {isAdmin && (
            <a
              href="/connect"
              className="rounded-btn border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-white"
            >
              Connections
            </a>
          )}
          {isAdmin && <SyncButton />}
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              className="rounded-btn border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <ChannelHealthPanel health={health} counts={queue.counts} isAdmin={isAdmin} now={now} />

      <nav className="mb-5 flex flex-wrap gap-1 border-b border-line" aria-label="Sections">
        {TABS.map((t) => (
          <a
            key={t.key}
            href={t.key === "queue" ? "/" : `/?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === t.key ? "border-ink font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
            {t.key === "queue" && !usingSamples ? ` (${queue.items.length}${queue.truncated ? "+" : ""})` : ""}
          </a>
        ))}
      </nav>

      {tab === "queue" && (
        <>
          {usingSamples && (
            <div className="mb-4 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm text-ink-muted">
              Showing sample comments, nothing here is real and the buttons do not touch YouTube.{" "}
              {isAdmin ? (
                <>
                  Connect a channel at{" "}
                  <a href="/connect" className="font-medium text-ink underline">
                    /connect
                  </a>{" "}
                  and hit Sync now. Real comments replace these once a channel is connected and synced.
                </>
              ) : (
                "Real comments replace these once Josh connects the channel."
              )}
            </div>
          )}
          <ReviewQueue comments={visible} channels={channels} demo={usingSamples} />
        </>
      )}

      {tab === "auto" && <AutoTab channels={channels} isAdmin={isAdmin} />}
      {tab === "authors" && <AuthorsPanel data={await loadAuthors(channels)} />}
      {tab === "activity" && (
        <ActivityList entries={await loadActivity(channels, { limit: 100 })} emptyText="No actions yet." />
      )}
    </main>
  );
}

async function AutoTab({ channels, isAdmin }: { channels: ChannelKey[]; isAdmin: boolean }) {
  let view: AutopilotView | null = null;
  try {
    const { loadGraduationState } = await import("@/lib/graduation-data");
    const s = await loadGraduationState();
    view = {
      status: s.status,
      paused: s.paused,
      reviewed: s.reviewed,
      required: s.required,
      signatures: s.signatures,
      daysElapsed: s.daysElapsed,
      windowStart: s.windowStart?.toISOString() ?? null,
      lastOverturnAt: s.lastOverturnAt?.toISOString() ?? null,
      missing: s.missing,
    };
  } catch {
    view = null;
  }
  const entries = await loadActivity(channels, { autoOnly: true, limit: 100 });
  return (
    <>
      <AutopilotPanel state={view} isAdmin={isAdmin} />
      <h2 className="mb-2 text-lg font-semibold text-ink">Recently auto-actioned</h2>
      <p className="mb-3 text-sm text-ink-muted">
        Everything Comment Copilot hid without a human click: graduated spam and comments from blocked authors. Spot-check
        here; Restore puts a comment back on public view and counts as an overturn.
      </p>
      <ActivityList entries={entries} emptyText="Nothing has been auto-actioned yet." />
    </>
  );
}
