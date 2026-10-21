"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Result = {
  channel: string;
  ok: boolean;
  commentsFetched?: number;
  newComments?: number;
  resolved?: number;
  triaged?: number;
  autoHidden?: number;
  remaining?: number;
  error?: string;
};

// Admin "Sync now": one full pull from YouTube, then triage-only rounds until
// every stored comment is categorized (each round is one request inside the
// function time limit). Errors are shown per channel in plain English.
const MAX_ROUNDS = 40;

export function SyncButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [lines, setLines] = useState<string[]>([]);
  const stopRef = useRef(false);

  async function call(phase: "full" | "triage"): Promise<Result[]> {
    const res = await fetch("/api/ingest/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data.results ?? [];
  }

  async function run() {
    stopRef.current = false;
    setState("running");
    setLines(["Pulling comments from YouTube…"]);
    const totals: Record<string, { fetched: number; fresh: number; resolved: number; triaged: number; auto: number; remaining: number; error?: string }> = {};
    const render = (suffix?: string) => {
      const out = Object.entries(totals).map(([ch, t]) => {
        if (t.error) return `${ch}: ${t.error}`;
        const parts = [`${t.fetched} comments seen`, `${t.fresh} new`, `${t.triaged} triaged`];
        if (t.resolved) parts.push(`${t.resolved} already answered`);
        if (t.auto) parts.push(`${t.auto} auto-hidden`);
        if (t.remaining) parts.push(`${t.remaining} still to triage`);
        return `${ch}: ${parts.join(", ")}`;
      });
      setLines(suffix ? [...out, suffix] : out);
    };
    const absorb = (results: Result[], first: boolean) => {
      for (const r of results) {
        const t = (totals[r.channel] ??= { fetched: 0, fresh: 0, resolved: 0, triaged: 0, auto: 0, remaining: 0 });
        if (first) {
          t.fetched = r.commentsFetched ?? 0;
          t.fresh = r.newComments ?? 0;
          t.resolved = r.resolved ?? 0;
        }
        t.triaged += r.triaged ?? 0;
        t.auto += r.autoHidden ?? 0;
        t.remaining = r.remaining ?? 0;
        // Keep the first-round error (e.g. token expired) visible.
        if (!r.ok && r.error) t.error = r.error;
      }
    };

    try {
      let results = await call("full");
      absorb(results, true);
      render();
      router.refresh();

      for (let round = 0; round < MAX_ROUNDS && !stopRef.current; round++) {
        const remaining = results.reduce((n, r) => n + (r.remaining ?? 0), 0);
        const progressed = results.some((r) => (r.triaged ?? 0) > 0);
        const blocked = results.some((r) => !r.ok && r.error && (r.triaged ?? 0) === 0 && (r.remaining ?? 0) > 0);
        if (remaining === 0 || (!progressed && round > 0) || blocked) break;
        render(`Sorting the backlog with Claude, ${remaining} to go…`);
        results = await call("triage");
        absorb(results, false);
        router.refresh();
      }
      const anyError = Object.values(totals).some((t) => t.error);
      setState(anyError ? "error" : "idle");
      render(stopRef.current ? "Stopped. The rest is picked up on the next sync." : undefined);
      router.refresh();
    } catch (err) {
      setState("error");
      setLines([err instanceof Error ? err.message : "Sync failed"]);
    }
  }

  return (
    <div className="flex max-w-xl flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {state === "running" && (
          <button
            type="button"
            onClick={() => (stopRef.current = true)}
            className="rounded-btn border border-line bg-white px-3 py-2 text-sm text-ink-muted transition hover:bg-bone"
          >
            Stop
          </button>
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
      {lines.length > 0 && (
        <div className={`text-right text-xs ${state === "error" ? "text-red-700" : "text-ink-muted"}`} role="status">
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
