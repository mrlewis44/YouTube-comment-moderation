// Drizzle client bound to Vercel Postgres.
// DATABASE_URL / POSTGRES_URL is provided by the Vercel Postgres integration.
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import * as schema from "./schema";

export const db = drizzle(sql, { schema });
export * from "./schema";
