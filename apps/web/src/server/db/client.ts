import { sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"
import { all, insertMany, lock, one, run } from "./sql"

/** Any Drizzle Postgres database or transaction over this schema (postgres-js in the app, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

// The schema is owned by supabase/migrations; this list is only for wiping data (demo databases and tests).
export const TABLES = [
  "draft_messages", "profile_drafts", "analysis_evidence", "analysis_runs", "event_classifications", "event_annotations",
  "imported_busy_intervals", "imported_events", "calendar_snapshots", "calendar_sync_runs", "calendar_sources", "calendar_connections",
  "service_leases", "search_messages", "mutation_operations", "oauth_attempts", "sessions", "auth_identities",
  "messages", "conversations", "events", "requests", "booking_searches", "meeting_types", "places", "availability_rules",
  "contacts", "profile_versions", "storage_settings", "users",
]

/** Deletes every row, keeping the tables. */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`))
}

/** Epoch-millisecond columns are `bigint`; postgres-js would hand them back as strings, so read them as numbers (safe far beyond year 9999). */
const bigintAsNumber = { to: 20, from: [20], parse: (value: string) => Number(value), serialize: (value: unknown) => String(value) }

export function createDb(url: string) {
  // Supabase's transaction pooler (port 6543) does not support prepared statements.
  const client = postgres(url, { prepare: false, types: { bigint: bigintAsNumber }, max: Number(process.env.DATABASE_POOL_MAX ?? 5) })
  return { client, db: drizzle(client, { schema }) as unknown as Db }
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

/**
 * A database is bound to one mode the first time it is used, so real accounts and demo/mock accounts can never share one.
 * Real mode additionally refuses a database that already holds accounts without a verified identity (e.g. seeded demo users).
 */
export async function bindDatabaseMode(db: Db, mode: "demo" | "real"): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('storage_settings', 0))`)
    const current = await one<{ mode: string }>(tx, "SELECT mode FROM storage_settings WHERE id=1")
    if (current && current.mode !== mode) throw new Error("Database mode does not match APP_MODE; use a separate database")
    if (current) return
    if (mode === "demo" && (await one(tx, "SELECT id FROM auth_identities LIMIT 1"))) throw new Error("Cannot use real identities in demo mode")
    if (mode === "real" && (await one(tx, "SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM auth_identities) LIMIT 1"))) throw new Error("Real mode requires a separate account database")
    await run(tx, "INSERT INTO storage_settings(id,mode) VALUES (1,?)", [mode])
  })
}

const bindings = new WeakMap<Db, Map<string, Promise<void>>>()
/** Binds the database to its mode once per process (and per mode); every request path goes through here before touching data. */
export function ensureBound(db: Db, mode: "demo" | "real"): Promise<void> {
  let map = bindings.get(db)
  if (!map) bindings.set(db, (map = new Map()))
  let pending = map.get(mode)
  if (!pending) {
    pending = bindDatabaseMode(db, mode)
    map.set(mode, pending)
    pending.catch(() => map.delete(mode)) // a failed attempt (e.g. database not reachable yet) may be retried
  }
  return pending
}

export { schema, all, insertMany, lock, one, run }
