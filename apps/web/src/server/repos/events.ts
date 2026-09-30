import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import type { CalEvent, LocationKind } from "@/core/types"
import type { Db } from "../db/client"
import { schema } from "../db/client"

export interface EventView extends CalEvent {
  source: "seed" | "manual" | "booking"
  requestId: string | null
}

export async function listEvents(db: Db, userId: string): Promise<EventView[]> {
  const rows = await db.select().from(schema.events).where(eq(schema.events.userId, userId))
  return rows
    .map((e) => ({
      id: e.id,
      title: e.title,
      startMs: Date.parse(e.startAt),
      endMs: Date.parse(e.endAt),
      kind: e.locationKind,
      placeRef: e.placeRef,
      source: e.source,
      requestId: e.requestId,
    }))
    .sort((a, b) => a.startMs - b.startMs)
}

export async function addEvent(
  db: Db,
  userId: string,
  input: { title: string; startMs: number; endMs: number; kind: LocationKind; placeRef: string | null; source?: "manual" | "booking"; requestId?: string | null },
): Promise<string> {
  const id = randomUUID()
  await db.insert(schema.events).values({
    id,
    userId,
    title: input.title,
    startAt: new Date(input.startMs).toISOString(),
    endAt: new Date(input.endMs).toISOString(),
    locationKind: input.kind,
    placeRef: input.placeRef,
    source: input.source ?? "manual",
    requestId: input.requestId ?? null,
  })
  return id
}

/** Accepted meetings (source=booking) are removed only through the request, never directly. */
export async function deleteEvent(db: Db, userId: string, id: string): Promise<boolean> {
  const [row] = await db.select().from(schema.events).where(and(eq(schema.events.id, id), eq(schema.events.userId, userId)))
  if (!row || row.source === "booking") return false
  await db.delete(schema.events).where(eq(schema.events.id, id))
  return true
}
