"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Posts a sample lead card to the Google Chat webhook via /api/notify-test.
export function TestAlertButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/notify-test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(data.error ?? `HTTP ${res.status}`);
      else setMsg(data.sent ? "Sent. Check the Chat space." : `Not sent: ${data.reason ?? "unknown"}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs">{msg}</span>}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="rounded-btn border border-line bg-white px-3 py-1.5 text-sm text-ink transition hover:bg-bone disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send test alert"}
      </button>
    </div>
  );
}
