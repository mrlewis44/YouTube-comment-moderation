// Per-channel connection health (server component): is a YouTube token
// connected, when did the last successful sync run, how many comments came in,
// how much is waiting, and the last error in plain English.

import type { ChannelHealth } from "@/lib/dashboard-data";
import type { UnansweredCounts } from "@/lib/backlog";
import type { ChannelKey } from "@/lib/domain";
import { ago, fmtDay, fmtTime } from "@/lib/format";

export function ChannelHealthPanel({
  health,
  counts,
  isAdmin,
  now,
}: {
  health: ChannelHealth[] | null;
  counts: Partial<Record<ChannelKey, UnansweredCounts>>;
  isAdmin: boolean;
  now: number;
}) {
  if (!health) {
    return (
      <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        Could not read connection status from the database. The queue below may be showing samples.
      </div>
    );
  }

  return (
    <section aria-label="Channel connection health" className="mb-6 grid gap-3 sm:grid-cols-2">
      {health.map((h) => {
        const c = counts[h.key];
        const problem = h.tokenError ?? (h.connected ? h.lastError : null);
        const state: "ok" | "warn" | "bad" = !h.connected || h.tokenError ? "bad" : problem ? "warn" : h.lastSuccessAt ? "ok" : "warn";
        const dot = state === "ok" ? "bg-emerald-500" : state === "warn" ? "bg-amber-500" : "bg-red-600";
        const label = !h.connected
          ? "Not connected"
          : h.tokenError
            ? "Needs reconnect"
            : problem
              ? "Last sync failed"
              : h.lastSuccessAt
                ? "Connected and syncing"
                : "Connected, not synced yet";
        return (
          <div key={h.key} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-ink">{h.displayName}</div>
                <div className="text-xs text-ink-muted">{h.handle}</div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink">
                <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
                {label}
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">YouTube token</dt>
              <dd className="text-ink">
                {h.connected ? (
                  <>
                    Connected{h.connectedAt ? ` ${fmtDay(h.connectedAt)}` : ""}
                    {h.connectedBy ? <span className="block text-xs text-ink-muted">by {h.connectedBy}</span> : null}
                  </>
                ) : (
                  "None stored"
                )}
              </dd>
              <dt className="text-ink-muted">Last successful sync</dt>
              <dd className="text-ink">
                {h.lastSuccessAt ? (
                  <>
                    {ago(h.lastSuccessAt, now)}
                    <span className="block text-xs text-ink-muted">{fmtTime(h.lastSuccessAt)}</span>
                  </>
                ) : (
                  "Never"
                )}
              </dd>
              <dt className="text-ink-muted">Comments pulled</dt>
              <dd className="text-ink">
                {h.lastFetched == null ? "None yet" : `${h.lastFetched} seen, ${h.lastNew ?? 0} new`}
                <span className="block text-xs text-ink-muted">{h.stored90d} stored from the last 90 days</span>
              </dd>
              <dt className="text-ink-muted">Unanswered</dt>
              <dd className="text-ink">
                <span className="font-semibold">{c?.questions ?? 0}</span> question{(c?.questions ?? 0) === 1 ? "" : "s"}
                <span className="block text-xs text-ink-muted">
                  {c?.needsReply ?? 0} need a reply
                  {c?.opportunities ? `, ${c.opportunities} possible lead${c.opportunities === 1 ? "" : "s"}` : ""}
                </span>
              </dd>
              {h.untriaged > 0 && (
                <>
                  <dt className="text-ink-muted">Waiting for triage</dt>
                  <dd className="text-ink">
                    {h.untriaged}
                    <span className="block text-xs text-ink-muted">
                      {isAdmin ? "Sync now keeps going until these are sorted" : "Sorted on the next sync"}
                    </span>
                  </dd>
                </>
              )}
            </dl>

            {!h.connected && (
              <p className="mt-3 rounded-btn border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {isAdmin ? (
                  <>
                    No YouTube token is stored, so this channel has not been authorized yet and nothing syncs.
                    Connect it at{" "}
                    <a href="/connect" className="font-medium underline">/connect</a>, choosing the Google account that
                    owns {h.handle} in the account picker. Google may show an unverified-app screen first; click
                    Advanced to continue.
                  </>
                ) : (
                  "Not connected to YouTube yet, so nothing syncs. Josh needs to connect it."
                )}
              </p>
            )}
            {h.connected && problem && (
              <p className="mt-3 rounded-btn border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                {problem}
                <span className="mt-1 block text-xs text-red-800">
                  {fmtTime(h.tokenError ? h.tokenErrorAt : h.lastErrorAt)}
                  {isAdmin && h.tokenError ? (
                    <>
                      {" · "}
                      <a href="/connect" className="font-medium underline">Reconnect now</a>
                    </>
                  ) : null}
                </span>
              </p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-muted sm:col-span-2">
        Automatic sync runs once a day at 13:00 UTC (6 AM Pacific in summer, 5 AM in winter), because the
        current Vercel plan only allows daily cron jobs. Use Sync now any time for a fresh pull.
      </p>
    </section>
  );
}
