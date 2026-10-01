import { sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

/** Any Drizzle Postgres database or transaction over this schema (postgres-js in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

// The schema is owned by supabase/migrations; this list is only for wiping data.
export const TABLES = [
  "messages",
  "conversations",
  "requests",
  "events",
  "meeting_types",
  "places",
  "availability_rules",
  "users",
]

/** Deletes every row, keeping the tables. */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")}`))
}

export function createDb(url: string) {
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  const client = postgres(url, { prepare: false })
  return { client, db: drizzle(client, { schema }) }
}

const globalForDb = globalThis as unknown as { __mvpDb?: ReturnType<typeof createDb> }

/** One pool per process; cached on globalThis so Next dev reloads don't open new pools. */
export function getDb(): Db {
  if (!globalForDb.__mvpDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example.")
    globalForDb.__mvpDb = createDb(url)
  }
  return globalForDb.__mvpDb.db
}

export { schema }
