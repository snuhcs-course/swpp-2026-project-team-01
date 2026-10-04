import { and, eq } from "drizzle-orm"
import type { AvailabilityRule } from "@/core/types"
import type { Db } from "../db/client"
import { one, schema } from "../db/client"

export interface UserRow {
  id: string
  name: string
}

export async function listUsers(db: Db): Promise<UserRow[]> {
  return db.select().from(schema.users)
}

export async function getUser(db: Db, id: string): Promise<UserRow | undefined> {
  const [r] = await db.select().from(schema.users).where(eq(schema.users.id, id))
  return r
}

export async function getRules(db: Db, userId: string): Promise<AvailabilityRule[]> {
  // A confirmed profile's meeting windows win; before one exists the stored rules are used as they are (no hours are invented).
  const profile = await one<{ values_json: string }>(db, "SELECT p.values_json FROM users u JOIN profile_versions p ON p.user_id=u.id AND p.version=u.current_profile_version WHERE u.id=?", [userId])
  if (profile) return (JSON.parse(profile.values_json).meetingWindows as { weekday: number; startMin: number; endMin: number }[]).map((w) => ({ ...w, enabled: true }))
  const rows = await db.select().from(schema.availabilityRules).where(eq(schema.availabilityRules.userId, userId))
  return rows.map(({ weekday, enabled, startMin, endMin }) => ({ weekday, enabled, startMin, endMin }))
}

export async function saveRules(db: Db, userId: string, rules: AvailabilityRule[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const r of rules) {
      await tx.delete(schema.availabilityRules).where(and(eq(schema.availabilityRules.userId, userId), eq(schema.availabilityRules.weekday, r.weekday)))
      await tx.insert(schema.availabilityRules).values({ userId, weekday: r.weekday, enabled: r.enabled, startMin: r.startMin, endMin: r.endMin })
    }
  })
}
