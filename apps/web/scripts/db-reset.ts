// Usage: npm run db:reset — wipes every row and inserts demo data dated from today (KST). Demo databases only; the schema comes from supabase/migrations.
import { createDb, truncateAll, bindDatabaseMode, all } from "@/server/db/client"
import { readServerConfig } from "@/server/config"
import { seed } from "@/server/db/seed"
import { seedPersonaProfiles } from "@/server/db/persona-profiles"

const config = readServerConfig()
if (!config.allowReset) throw new Error("실제 계정 DB는 초기화할 수 없어요")
if (!config.databaseUrl) throw new Error("DATABASE_URL이 필요해요 (로컬: supabase start 후 postgresql://postgres:postgres@127.0.0.1:54322/postgres)")
const { client, db } = createDb(config.databaseUrl)
try {
  await truncateAll(db)
  await bindDatabaseMode(db, config.mode)
  await seed(db, Date.now())
  await seedPersonaProfiles(db, Date.now())
  const count = async (t: string) => (await all<{ n: number }>(db, `SELECT COUNT(*)::int AS n FROM ${t}`))[0].n
  console.log(`reset: users=${await count("users")} events=${await count("events")} places=${await count("places")} meeting_types=${await count("meeting_types")}`)
} finally {
  await client.end()
}
