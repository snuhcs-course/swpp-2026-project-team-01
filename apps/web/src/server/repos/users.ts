import { and, eq } from "drizzle-orm"
import { defaultRules } from "@/core/availability"
import type { AvailabilityRule } from "@/core/types"
import type { Db } from "../db/client"
import { schema } from "../db/client"

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
  const rows = await db.select().from(schema.availabilityRules).where(eq(schema.availabilityRules.userId, userId))
  const byDay = new Map(rows.map((r) => [r.weekday, r]))
  return defaultRules().map((d) => {
    const r = byDay.get(d.weekday)
    return r ? { weekday: r.weekday, enabled: r.enabled, startMin: r.startMin, endMin: r.endMin } : d
  })
}

export async function saveRules(db: Db, userId: string, rules: AvailabilityRule[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const r of rules) {
      await tx.delete(schema.availabilityRules).where(and(eq(schema.availabilityRules.userId, userId), eq(schema.availabilityRules.weekday, r.weekday)))
      await tx.insert(schema.availabilityRules).values({ userId, weekday: r.weekday, enabled: r.enabled, startMin: r.startMin, endMin: r.endMin })
    }
  })
}
