// Seed the channels and users rows (SPEC Sections 1, 2). Idempotent: safe to
// run repeatedly, it upserts on the natural keys. Run once the database is
// provisioned: `pnpm db:push` then `pnpm db:seed`.

import { db, channels, users } from "../src/db";
import { CHANNELS } from "../src/lib/domain";
import { accessFor } from "../src/lib/access";
import { sql } from "drizzle-orm";

async function main() {
  // Channels. oauth_refresh_token stays null here; it is written by the
  // per-channel YouTube OAuth flow, encrypted, never seeded in plaintext.
  const channelIdByKey: Record<string, number> = {};
  for (const ch of Object.values(CHANNELS)) {
    const [row] = await db
      .insert(channels)
      .values({
        platform: "youtube",
        platformChannelId: ch.platformChannelId,
        displayName: ch.displayName,
      })
      .onConflictDoUpdate({
        target: [channels.platform, channels.platformChannelId],
        set: { displayName: ch.displayName },
      })
      .returning({ id: channels.id });
    channelIdByKey[ch.key] = row.id;
  }

  // Users and their per-channel access.
  const seededUsers = ["josh@buywisemortgage.com", "jeb@jebsmith.net"];
  for (const email of seededUsers) {
    const access = accessFor(email);
    const channelIds = access.channels.map((k) => channelIdByKey[k]);
    await db
      .insert(users)
      .values({ email, role: access.role, channelAccess: channelIds })
      .onConflictDoUpdate({
        target: users.email,
        set: { role: access.role, channelAccess: channelIds },
      });
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(channels);
  console.log(`Seeded. ${count} channels present.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
