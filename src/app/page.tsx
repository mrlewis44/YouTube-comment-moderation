import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { CHANNELS, type ChannelKey } from "@/lib/domain";
import { MOCK_COMMENTS } from "@/lib/mock";
import { ReviewQueue } from "@/components/ReviewQueue";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const { email, role, channels } = session.user;
  // Only show comments on channels this reviewer may access (SPEC Section 2).
  const accessible = new Set<ChannelKey>(channels);
  const visible = MOCK_COMMENTS.filter((c) => accessible.has(c.channel));

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
      </header>

      <div className="mb-4 rounded-2xl border border-line bg-white/60 px-4 py-3 text-sm text-ink-muted">
        Running on sample comments. Live YouTube ingestion, categorization, and
        posting are wired once the OAuth scope, database, and API keys are in
        place (see SPEC Sections 3, 9, 11).
      </div>

      <ReviewQueue
        comments={visible}
        channels={channels}
        canModerate={role === "admin" || role === "member"}
      />
    </main>
  );
}
