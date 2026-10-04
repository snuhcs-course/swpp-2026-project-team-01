import { randomUUID } from "node:crypto"
import { desc, eq } from "drizzle-orm"
import type { Db } from "../db/client"
import { schema } from "../db/client"

export type RequestRow = typeof schema.requests.$inferSelect
export type RequestStatus = RequestRow["status"]

export function toLike(r: RequestRow) {
  return { id: r.id, startMs: Date.parse(r.startAt), endMs: Date.parse(r.endAt), status: r.status }
}

export async function insertRequest(
  db: Db,
  input: { clientId: string; hostId: string; startMs: number; endMs: number; placeId: string; meetingTypeId: string; message: string },
  nowMs: number,
): Promise<RequestRow> {
  const row: RequestRow = {
    id: randomUUID(),
    clientId: input.clientId,
    hostId: input.hostId,
    startAt: new Date(input.startMs).toISOString(),
    endAt: new Date(input.endMs).toISOString(),
    placeId: input.placeId,
    meetingTypeId: input.meetingTypeId,
    message: input.message,
    status: "pending",
    createdAt: new Date(nowMs).toISOString(),
    decidedAt: null,
    revision: 0,
    searchId: null,
    durationMinSnapshot: null,
    meetingTypeNameSnapshot: null,
    placeSnapshotJson: null,
    definitionState: "unconfirmed",
  }
  await db.insert(schema.requests).values(row)
  return row
}

export async function getRequest(db: Db, id: string): Promise<RequestRow | undefined> {
  const [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, id))
  return r
}

export async function listByClient(db: Db, clientId: string): Promise<RequestRow[]> {
  return db.select().from(schema.requests).where(eq(schema.requests.clientId, clientId)).orderBy(desc(schema.requests.startAt))
}

export async function listByHost(db: Db, hostId: string): Promise<RequestRow[]> {
  return db.select().from(schema.requests).where(eq(schema.requests.hostId, hostId)).orderBy(desc(schema.requests.startAt))
}

export async function setStatus(db: Db, id: string, status: RequestStatus, nowMs: number): Promise<void> {
  await db.update(schema.requests).set({ status, decidedAt: new Date(nowMs).toISOString() }).where(eq(schema.requests.id, id))
}
