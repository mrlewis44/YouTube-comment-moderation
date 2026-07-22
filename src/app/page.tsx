import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { CHANNELS, type ChannelKey } from "@/lib/domain";
import { MOCK_COMMENTS } from "@/lib/mock";
import { loadQueue } from "@/lib/queue-data";
import { ReviewQueue } from "@/components/ReviewQueue";
import { SyncButton } from "@/components/SyncButton";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { email, role, channels } = session.user;
  const accessible = new Set<ChannelKey>(channels);

  // Prefer live comments from the DB; fall back to samples when there are none
  // yet (before a channel is connected and ingested).
  const live = await loadQueue(channels);
  const usingSamples = live.length === 0;
  const visible = usingSamples
    ? MOCK_COMMENTS.filter((c) => accessible.has(c.channel))
    : live;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="text-sm font-medium uppercase tracking-wide text-ink-muted">
            Comment Copilot
          </div>
          <h1 className="text-2xl font-semibold text-ink">Review queue</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {channels.length === 1
              ? `${CHANNELS[channels[0]].displayName}`
              : channels.map((c) => CHANNELS[c].displayName).join(" and ")}
            {" · "}
            {email} ({role})
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === "admin" && <SyncButton />}
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

      {usingSamples && (
        <div className="mb-4 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm text-ink-muted">
          Showing sample comments. Connect a channel at{" "}
          <a href="/connect" className="font-medium text-ink underline">
            /connect
          </a>{" "}
          and hit Sync now, real comments replace these automatically once a
          channel is authorized and ingested.
        </div>
      )}

      <ReviewQueue
        comments={visible}
        channels={channels}
        canModerate={role === "admin" || role === "member"}
      />
    </main>
  );
}
