"use client";

// Spam autopilot status (SPEC Section 7): progress toward graduation, and an
// admin pause switch.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SPAM_SIGNATURE_LABELS, type SpamSignature } from "@/lib/graduation";
import { fmtDay } from "@/lib/format";

export type AutopilotView = {
  status: "learning" | "graduated" | "paused";
  paused: boolean;
  reviewed: number;
  required: number;
  signatures: string[];
  daysElapsed: number;
  windowStart: string | null;
  lastOverturnAt: string | null;
  missing: string[];
};

export function AutopilotPanel({ state, isAdmin }: { state: AutopilotView | null; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!state) {
    return <p className="mb-4 text-sm text-red-800">Could not read spam autopilot status.</p>;
  }

  const paused = state.paused;
  async function toggle() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !paused }),
      });
      if (!res.ok) setError(`Failed (HTTP ${res.status}).`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const headline =
    state.status === "graduated"
      ? "On: confident spam is hidden automatically"
      : state.status === "paused"
        ? "Paused: criteria met, but auto-hide is switched off"
        : paused
          ? "Learning, and switched off: it will not auto-hide even after it qualifies"
          : "Learning: every spam decision is still yours";

  return (
    <section className="mb-5 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Spam autopilot</div>
          <div className="font-medium text-ink">{headline}</div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="rounded-btn border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-bone disabled:opacity-60"
          >
            {paused ? "Allow autopilot" : "Pause autopilot"}
          </button>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Human-reviewed</dt>
          <dd className="text-ink">{state.reviewed} of {state.required}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Overturned in window</dt>
          <dd className="text-ink">0</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Signatures seen</dt>
          <dd className="text-ink">
            {state.signatures.length ? state.signatures.map((s) => SPAM_SIGNATURE_LABELS[s as SpamSignature] ?? s).join(", ") : "None yet"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Track record</dt>
          <dd className="text-ink">
            {state.windowStart ? `${Math.floor(state.daysElapsed)} of 7 days (since ${fmtDay(state.windowStart)})` : "Not started"}
          </dd>
        </div>
      </dl>
      {state.missing.length > 0 && <p className="mt-2 text-sm text-ink-muted">Still needed: {state.missing.join(", ")}.</p>}
      <p className="mt-2 text-xs text-ink-muted">
        Rules (SPEC Section 7): 25 human-reviewed spam calls with none overturned, at least two distinct spam
        signatures, and at least 7 days. Marking a flagged comment Not spam, or restoring a hidden one, counts as an
        overturn and restarts the count{state.lastOverturnAt ? ` (last overturn ${fmtDay(state.lastOverturnAt)})` : ""}.
        Once on, only confident matches of the two known signatures are hidden, using a reversible hide, and each one
        is listed below. Troll, reply, and political decisions always stay with a human.
      </p>
      {error && <p className="mt-2 text-sm text-red-800">{error}</p>}
    </section>
  );
}
