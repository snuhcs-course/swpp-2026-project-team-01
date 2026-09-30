import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import type { MeetingType, Place, PlaceKind } from "@/core/types"
import type { Db } from "../db/client"
import { schema } from "../db/client"

export async function listPlaces(db: Db, hostId: string): Promise<Place[]> {
  const rows = await db.select().from(schema.places).where(eq(schema.places.hostId, hostId))
  return rows.map((p) => ({ id: p.id, kind: p.kind, name: p.name }))
}

export async function addPlace(db: Db, hostId: string, input: { kind: PlaceKind; name: string }): Promise<Place> {
  const row = { id: randomUUID(), hostId, kind: input.kind, name: input.name }
  await db.insert(schema.places).values(row)
  return { id: row.id, kind: row.kind, name: row.name }
}

export async function updatePlace(db: Db, hostId: string, id: string, input: { kind: PlaceKind; name: string }): Promise<boolean> {
  const rows = await db.update(schema.places).set(input).where(and(eq(schema.places.id, id), eq(schema.places.hostId, hostId))).returning({ id: schema.places.id })
  return rows.length > 0
}

export async function deletePlace(db: Db, hostId: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.places).where(and(eq(schema.places.id, id), eq(schema.places.hostId, hostId))).returning({ id: schema.places.id })
  return rows.length > 0
}

export async function listMeetingTypes(db: Db, hostId: string): Promise<MeetingType[]> {
  const rows = await db.select().from(schema.meetingTypes).where(eq(schema.meetingTypes.hostId, hostId))
  return rows.map((t) => ({ id: t.id, name: t.name, durationMin: t.durationMin }))
}

export async function addMeetingType(db: Db, hostId: string, input: { name: string; durationMin: number }): Promise<MeetingType> {
  const row = { id: randomUUID(), hostId, name: input.name, durationMin: input.durationMin }
  await db.insert(schema.meetingTypes).values(row)
  return { id: row.id, name: row.name, durationMin: row.durationMin }
}

export async function updateMeetingType(db: Db, hostId: string, id: string, input: { name: string; durationMin: number }): Promise<boolean> {
  const rows = await db.update(schema.meetingTypes).set(input).where(and(eq(schema.meetingTypes.id, id), eq(schema.meetingTypes.hostId, hostId))).returning({ id: schema.meetingTypes.id })
  return rows.length > 0
}

export async function deleteMeetingType(db: Db, hostId: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.meetingTypes).where(and(eq(schema.meetingTypes.id, id), eq(schema.meetingTypes.hostId, hostId))).returning({ id: schema.meetingTypes.id })
  return rows.length > 0
}
