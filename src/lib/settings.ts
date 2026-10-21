// App-wide switches stored in the app_settings table.

import { eq } from "drizzle-orm";
import { db, appSettings } from "@/db";

export const SPAM_AUTOPILOT_PAUSED = "spam_autopilot_paused";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string, by: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy: by, updatedAt: new Date() },
    });
}

export async function isSpamAutopilotPaused(): Promise<boolean> {
  return (await getSetting(SPAM_AUTOPILOT_PAUSED)) === "true";
}
