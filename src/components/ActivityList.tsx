"use client";

// Action log view. With autoOnly it is the "recently auto-actioned" list from
// SPEC Section 7: every comment the system hid on its own, with a Restore
// button so Josh and Jeb can spot-check after the fact.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANNELS } from "@/lib/domain";
import type { ActivityEntry } from "@/lib/dashboard-data";
import { SPAM_SIGNATURE_LABELS, type SpamSignature } from "@/lib/graduation";
import { fmtTime, youtubeCommentUrl } from "@/lib/format";

const ACTION_LABELS: Record<string, string> = {
  post_reply: "Reply posted",
  hide: "Hidden",
  hide_and_block: "Removed and author blocked",
  dismiss: "Dismissed",
  dismiss_not_spam: "Marked not spam",
  restore: "Restored",
  auto_hide_spam: "Auto-hidden as spam",
  auto_hide_blocked_author: "Auto-hidden, blocked author",
  auto_delete_blocked_author: "Auto-hidden, blocked author",
  resolved_by_host_reply: "Resolved, a host already replied",
};

function label(type: string): string {
  if (type.endsWith("_failed")) return `${ACTION_LABELS[type.replace(/_failed$/, "")] ?? type} (failed)`;
  return ACTION_LABELS[type] ?? type;
}

export function ActivityList({ entries, emptyText }: { entries: ActivityEntry[] | null; emptyText: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Record<number, { ok: boolean; text: string }>>({});

  if (entries === null) {
    return <p className="text-sm text-red-800">Could not load the action log.</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">{emptyText}</p>
    );
  }

  async function restore(e: ActivityEntry) {
    setBusy(e.id);
    try {
      const res = await fetch("/api/review/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: e.reviewId, action: "restore" }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setMsgs((p) => ({ ...p, [e.id]: { ok: res.ok, text: res.ok ? data.message ?? "Restored." : data.error ?? `Failed (HTTP ${res.status}).` } }));
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-2">
      {entries.map((e) => {
        const error = typeof e.detail?.error === "string" ? (e.detail.error as string) : null;
        return (
          <li key={e.id} className="rounded-2xl border border-line bg-white p-3 text-sm shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span className="font-medium text-ink">{label(e.actionType)}</span>
              <span>· {CHANNELS[e.channel].displayName}</span>
              <span>· {fmtTime(e.performedAt)}</span>
              <span>· by {e.performedBy === "system" ? "Comment Copilot" : e.performedBy ?? "unknown"}</span>
              {e.spamSignature && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">
                  {SPAM_SIGNATURE_LABELS[e.spamSignature as SpamSignature] ?? e.spamSignature}
                </span>
              )}
              {e.reviewStatus === "restored" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-900">now restored</span>}
              {e.detail?.mocked === true && <span className="rounded-full bg-neutral-100 px-2 py-0.5">mock</span>}
            </div>
            <div className="mt-1 text-ink">
              <span className="font-medium">{e.author}</span>
              {e.videoTitle ? <span className="text-ink-muted"> on “{e.videoTitle}”</span> : null}
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-ink">{e.text}</p>
            {error && <p className="mt-1 text-xs text-red-800">{error}</p>}
            {msgs[e.id] && <p className={`mt-1 text-xs ${msgs[e.id].ok ? "text-ink-muted" : "text-red-800"}`}>{msgs[e.id].text}</p>}
            <div className="mt-2 flex items-center gap-3">
              {e.canRestore && (
                <button
                  type="button"
                  disabled={busy === e.id}
                  onClick={() => restore(e)}
                  className="rounded-btn border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-bone disabled:opacity-60"
                >
                  {busy === e.id ? "Restoring…" : "Restore to public view"}
                </button>
              )}
              <a href={youtubeCommentUrl(e.videoId, e.platformCommentId)} target="_blank" rel="noreferrer" className="text-sm text-ink-muted underline hover:text-ink">
                Open on YouTube
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
