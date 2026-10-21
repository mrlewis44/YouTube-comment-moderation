"use client";

// Repeat offenders (one-click block) and blocked authors (SPEC Section 5).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANNELS } from "@/lib/domain";
import type { AuthorEntry } from "@/lib/dashboard-data";
import { BLOCK_SURFACE_OFFENSES } from "@/lib/moderation-rules";
import { fmtDay } from "@/lib/format";

export function AuthorsPanel({ data }: { data: { offenders: AuthorEntry[]; blocked: AuthorEntry[] } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Record<number, { ok: boolean; text: string }>>({});

  if (!data) return <p className="text-sm text-red-800">Could not load authors.</p>;

  async function setBlocked(a: AuthorEntry, block: boolean) {
    setBusy(a.id);
    try {
      const res = await fetch("/api/authors/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorId: a.id, block }),
      });
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setMsgs((p) => ({ ...p, [a.id]: { ok: res.ok, text: res.ok ? d.message ?? "Done." : d.error ?? `Failed (HTTP ${res.status}).` } }));
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const row = (a: AuthorEntry, blocked: boolean) => (
    <li key={a.id} className="rounded-2xl border border-line bg-white p-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-ink">
            {a.channelUrl ? (
              <a href={a.channelUrl} target="_blank" rel="noreferrer" className="underline">
                {a.displayName}
              </a>
            ) : (
              a.displayName
            )}
          </div>
          <div className="text-xs text-ink-muted">
            {CHANNELS[a.channel].displayName} · {a.offenseCount} offense{a.offenseCount === 1 ? "" : "s"}
            {a.lastFlaggedAt ? ` · last ${fmtDay(a.lastFlaggedAt)}` : ""}
            {blocked && a.blockedAt
              ? ` · blocked ${fmtDay(a.blockedAt)} by ${a.blockedBy ?? "unknown"} (${a.blockedReason === "single_attack" ? "single attack" : "repeat pattern"})`
              : ""}
          </div>
        </div>
        <button
          type="button"
          disabled={busy === a.id}
          onClick={() => setBlocked(a, !blocked)}
          className={`rounded-btn border px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
            blocked ? "border-line bg-white text-ink hover:bg-bone" : "border-red-200 bg-white text-red-800 hover:bg-red-50"
          }`}
        >
          {busy === a.id ? "Working…" : blocked ? "Unblock" : "Block author"}
        </button>
      </div>
      {msgs[a.id] && <p className={`mt-1 text-xs ${msgs[a.id].ok ? "text-ink-muted" : "text-red-800"}`}>{msgs[a.id].text}</p>}
    </li>
  );

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-lg font-semibold text-ink">Repeat offenders</h2>
        <p className="mb-3 text-sm text-ink-muted">
          Authors with {BLOCK_SURFACE_OFFENSES} or more troll or spam comments hidden who are not blocked yet. Blocking
          applies YouTube&apos;s ban and hides their future comments on ingestion, before triage.
        </p>
        {data.offenders.length ? (
          <ul className="space-y-2">{data.offenders.map((a) => row(a, false))}</ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">No repeat offenders.</p>
        )}
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-ink">Blocked</h2>
        {data.blocked.length ? (
          <ul className="space-y-2">{data.blocked.map((a) => row(a, true))}</ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">Nobody is blocked.</p>
        )}
      </section>
    </div>
  );
}
