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
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const results: Array<{
        channel?: string;
        queued?: number;
        remaining?: number;
        duplicates?: number;
        autoDeleted?: number;
        error?: string;
      }> = data.results ?? [];

      // Per-channel detail, INCLUDING errors, so failures are visible.
      const lines = results.map((r) => {
        if (r.error) return `${r.channel}: ERROR — ${r.error}`;
        const parts = [`+${r.queued ?? 0} new`];
        if (r.remaining) parts.push(`~${r.remaining} left`);
        if (r.duplicates) parts.push(`${r.duplicates} already stored`);
        if (r.autoDeleted) parts.push(`${r.autoDeleted} auto-hidden`);
        return `${r.channel}: ${parts.join(", ")}`;
      });
      const anyError = results.some((r) => r.error);
      setState(anyError ? "error" : "idle");
      setMsg(lines.join("  |  ") || "no channels connected");
      router.refresh();
    } catch (err) {
      setState("error");
      setMsg(err instanceof Error ? err.message : "Sync failed");
    }
  }

  return (
    <div className="flex max-w-xl items-center gap-2">
      {msg && (
        <span
          className={`text-xs ${state === "error" ? "text-red-700" : "text-ink-muted"}`}
        >
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={state === "running"}
        className="shrink-0 rounded-btn bg-ink px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {state === "running" ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
