"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admin "Sync now": triggers ingestion, then refreshes the queue so freshly
// pulled comments appear. A no-op-safe convenience over waiting for the cron.
export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  async function run() {
    setState("running");
    setMsg("");
    try {
      const res = await fetch("/api/ingest/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const results = data.results ?? [];
      const queued = results.reduce(
        (n: number, r: { queued?: number }) => n + (r.queued ?? 0),
        0,
      );
      const remaining = results.reduce(
        (n: number, r: { remaining?: number }) => n + (r.remaining ?? 0),
        0,
      );
      setState("idle");
      setMsg(
        queued > 0
          ? remaining > 0
            ? `+${queued} new · ~${remaining} left, click again`
            : `+${queued} new`
          : "up to date",
      );
      router.refresh();
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Sync failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-ink-muted">{msg}</span>}
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="rounded-btn bg-ink px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === "running" ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
