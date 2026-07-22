// Applies pending Drizzle migrations at deploy time (Vercel build), over the
// serverless HTTP driver so it works in the build environment. Idempotent:
// the migrator records applied migrations and skips them on later deploys.
//
// Guarded: if no database is configured yet (before Vercel Postgres is added),
// this is a no-op so the build still succeeds.

import { migrate } from "drizzle-orm/vercel-postgres/migrator";
import { db } from "../src/db";

async function main() {
  const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] No database URL set, skipping migrations.");
    return;
  }
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] Migrations applied.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate] Failed:", err);
    process.exit(1);
  });
