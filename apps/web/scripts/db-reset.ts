// Usage: npm run db:reset — wipes all rows and inserts demo data dated from today (KST).
// Tables come from supabase/migrations (`supabase db reset` at the repo root).
import { sql } from "drizzle-orm"
import { createDb, truncateAll } from "@/server/db/client"
import { seed } from "@/server/db/seed"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is not set. See .env.example.")
const { client, db } = createDb(url)
await truncateAll(db)
await seed(db, Date.now())
const count = async (t: string) => (await db.execute<{ n: number }>(sql.raw(`SELECT COUNT(*)::int AS n FROM ${t}`)))[0].n
console.log(`reset ${new URL(url).host}: users=${await count("users")} events=${await count("events")} places=${await count("places")} meeting_types=${await count("meeting_types")}`)
await client.end()
