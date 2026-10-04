import { PGlite, types } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { T } from "../core/helpers"
import { all, one, run, schema, truncateAll, type Db } from "@/server/db/client"
import { SEED_USERS, seed } from "@/server/db/seed"
import { computeBookable } from "@/server/services/schedule"

/** Monday 2026-10-05 00:00 KST. */
export const NOW = T("2026-10-05", "00:00")
export const U = {
  host: SEED_USERS.minjun.id,
  host2: SEED_USERS.seoyeon.id,
  jiho: SEED_USERS.jiho.id,
  hana: SEED_USERS.hana.id,
}

const MIGRATIONS = fileURLToPath(new URL("../../../../supabase/migrations", import.meta.url))

/** In-process Postgres built from the same migrations Supabase applies. */
async function migratedDb(): Promise<Db> {
  // int8 holds epoch milliseconds; read it as a number like the app's postgres-js client does.
  const pg = new PGlite({ parsers: { [types.INT8]: (value: string) => Number(value) } })
  // The migrations grant to Supabase's API roles, which plain Postgres doesn't have.
  await pg.exec("create role anon; create role authenticated; create role service_role;")
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"))
  }
  return drizzle(pg, { schema }) as unknown as Db
}

// One database per test file; each test starts from freshly seeded rows.
let shared: Promise<Db> | undefined

/** Small async stand-in for the raw SQL handle tests poke at (`sqlite.prepare(sql).get(...)`), kept so assertions read the same as the SQL they check. */
export function rawSql(db: Db) {
  const client = (db as unknown as { $client: PGlite }).$client
  return {
    exec: async (text: string): Promise<void> => { await client.exec(text) },
    prepare: (text: string) => ({
      get: (...params: unknown[]) => one<any>(db, text, params),
      all: (...params: unknown[]) => all<any>(db, text, params),
      run: (...params: unknown[]) => run(db, text, params),
    }),
    close: () => {},
  }
}

/** Empty tables only (no demo rows). */
export async function emptyDb() {
  shared ??= migratedDb()
  const db = await shared
  await truncateAll(db)
  return { db, sqlite: rawSql(db) }
}

export async function freshDb() {
  const { db, sqlite } = await emptyDb()
  await seed(db, NOW)
  return { db, sqlite }
}

/** First online 30-minute slot both people share on or after `fromMs`. */
export async function firstOnlineSlot(db: Db, clientId: string, hostId: string, fromMs = NOW) {
  const { slots, places, meetingTypes } = await computeBookable(db, clientId, hostId, NOW)
  const online = places.find((p) => p.kind === "online")!
  const t30 = meetingTypes.find((t) => t.durationMin === 30)!
  const slot = slots.find((s) => s.placeId === online.id && s.meetingTypeId === t30.id && s.startMs >= fromMs)!
  return { slot, online, t30, places, meetingTypes }
}
