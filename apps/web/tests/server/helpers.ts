import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { T } from "../core/helpers"
import { schema, truncateAll, type Db } from "@/server/db/client"
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
  const pg = new PGlite()
  // The migrations grant to Supabase's API roles, which plain Postgres doesn't have.
  await pg.exec("create role anon; create role authenticated; create role service_role;")
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"))
  }
  return drizzle(pg, { schema })
}

// One database per test file; each test starts from freshly seeded rows.
let shared: Promise<Db> | undefined

export async function freshDb() {
  shared ??= migratedDb()
  const db = await shared
  await truncateAll(db)
  await seed(db, NOW)
  return { db }
}

/** First online 30-minute slot both people share on or after `fromMs`. */
export async function firstOnlineSlot(db: Db, clientId: string, hostId: string, fromMs = NOW) {
  const { slots, places, meetingTypes } = await computeBookable(db, clientId, hostId, NOW)
  const online = places.find((p) => p.kind === "online")!
  const t30 = meetingTypes.find((t) => t.durationMin === 30)!
  const slot = slots.find((s) => s.placeId === online.id && s.meetingTypeId === t30.id && s.startMs >= fromMs)!
  return { slot, online, t30, places, meetingTypes }
}
