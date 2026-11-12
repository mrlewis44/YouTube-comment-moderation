// Google Chat alert health (admin only): is the webhook set, when did the last
// alert go out, and a warning when the most recent attempt failed. Includes a
// "Send test alert" button that posts a sample card to the Chat space.

import type { AlertHealth } from "@/lib/alert-health";
import { ago, fmtTime } from "@/lib/format";
import { TestAlertButton } from "./TestAlertButton";

export function AlertHealthPanel({ health, now }: { health: AlertHealth | null; now: number }) {
  if (!health) return null;
  const broken = !health.webhookConfigured || !!health.lastError;
  return (
    <section
      aria-label="Google Chat alerts"
      className={`mb-6 rounded-2xl border px-4 py-3 text-sm ${
        broken ? "border-red-200 bg-red-50 text-red-900" : "border-line bg-white text-ink"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-medium">Google Chat lead alerts: </span>
          {!health.webhookConfigured ? (
            "OFF. GOOGLE_CHAT_WEBHOOK_URL is not set in Vercel, so possible leads are not being sent to Chat."
          ) : health.lastError ? (
            <>
              NOT REACHING CHAT. The last alert failed ({health.lastError}
              {health.lastErrorAt ? `, ${fmtTime(health.lastErrorAt)}` : ""}). Check the webhook in the Chat space
              and the URL in Vercel, then send a test.
            </>
          ) : health.lastOkAt ? (
            <>
              working. Last alert sent {ago(health.lastOkAt, now)}.
            </>
          ) : (
            "on, no alert sent yet. Send a test to confirm the Chat space receives it."
          )}
        </div>
        <TestAlertButton />
      </div>
    </section>
  );
}
