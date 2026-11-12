// Google Chat alert health. notify.ts never throws into ingestion, which also
// meant a broken webhook failed silently. Every real send attempt now goes
// through notifyAndRecord: it logs the outcome to Vercel's runtime logs and
// stores the last success and last failure in app_settings, so the dashboard
// can warn when alerts are not reaching Google Chat.

import { notifyOpportunity, type OpportunityNotice } from "./notify";
import { getSetting, setSetting } from "./settings";

export const ALERT_LAST_OK_AT = "chat_alert_last_ok_at";
export const ALERT_LAST_ERROR = "chat_alert_last_error";
export const ALERT_LAST_ERROR_AT = "chat_alert_last_error_at";

export type AlertOutcome = { sent: boolean; reason?: string; attempted: boolean };

/** A result that means the comment qualified but the card did not go out. */
export function isAlertFailure(o: { sent: boolean; reason?: string }): boolean {
  return !o.sent && o.reason !== "below threshold";
}

export async function notifyAndRecord(n: OpportunityNotice, by = "system"): Promise<AlertOutcome> {
  const outcome = await notifyOpportunity(n);
  const tag = `[chat alert] ${n.channel} comment=${n.platformCommentId} ${n.opportunityType}:${n.opportunityScore.toFixed(2)}`;
  if (outcome.sent) {
    console.log(`${tag} sent`);
    await safeSet(ALERT_LAST_OK_AT, new Date().toISOString(), by);
    return { ...outcome, attempted: true };
  }
  if (isAlertFailure(outcome)) {
    console.error(`${tag} NOT SENT: ${outcome.reason}`);
    await safeSet(ALERT_LAST_ERROR, outcome.reason ?? "send failed", by);
    await safeSet(ALERT_LAST_ERROR_AT, new Date().toISOString(), by);
    return { ...outcome, attempted: true };
  }
  return { ...outcome, attempted: false };
}

async function safeSet(key: string, value: string, by: string) {
  try {
    await setSetting(key, value, by);
  } catch (err) {
    console.error(`[chat alert] could not record ${key}: ${err instanceof Error ? err.message : err}`);
  }
}

export type AlertHealth = {
  webhookConfigured: boolean;
  lastOkAt: string | null;
  lastError: string | null; // only when newer than the last success
  lastErrorAt: string | null;
};

export async function loadAlertHealth(webhookConfigured: boolean): Promise<AlertHealth | null> {
  try {
    const [okAt, err, errAt] = await Promise.all([
      getSetting(ALERT_LAST_OK_AT),
      getSetting(ALERT_LAST_ERROR),
      getSetting(ALERT_LAST_ERROR_AT),
    ]);
    const errIsCurrent = !!errAt && (!okAt || errAt > okAt);
    return {
      webhookConfigured,
      lastOkAt: okAt,
      lastError: errIsCurrent ? err : null,
      lastErrorAt: errIsCurrent ? errAt : null,
    };
  } catch {
    return null;
  }
}
