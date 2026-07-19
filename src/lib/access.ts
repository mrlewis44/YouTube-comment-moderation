// Role and per-channel access (SPEC Section 2).
//
// App login (allowlist in env.ts) is separate from YouTube API authorization.
// This module answers "which channels may this signed-in person review?" and
// "are they admin or member?". The seed (scripts/seed.ts) writes the same
// mapping into the users table; this static map is the source both share so
// access is correct even before the DB is provisioned.

import type { ChannelKey, Role } from "./domain";

type AccessEntry = { role: Role; channels: ChannelKey[] };

// Josh: admin, both channels. Jeb: member, TEHB only (SPEC Section 2).
const ACCESS: Record<string, AccessEntry> = {
  "josh@buywisemortgage.com": { role: "admin", channels: ["tehb", "josh"] },
  "jeb@jebsmith.net": { role: "member", channels: ["tehb"] },
};

export function accessFor(email: string | null | undefined): AccessEntry {
  if (!email) return { role: "member", channels: [] };
  return ACCESS[email.toLowerCase()] ?? { role: "member", channels: [] };
}

export function canAccessChannel(
  email: string | null | undefined,
  channel: ChannelKey,
): boolean {
  return accessFor(email).channels.includes(channel);
}
