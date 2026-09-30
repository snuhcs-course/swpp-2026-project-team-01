import { sql } from "drizzle-orm"
import { autoDeclineIds, groupOverlapping, isExpired, overlapsOwnPending } from "@/core/booking"
import { sameSlot } from "@/core/slots"
import { formatKstDateTime } from "@/core/time"
import type { Db } from "../db/client"
import { addEvent } from "../repos/events"
import { listMeetingTypes, listPlaces } from "../repos/hosting"
import { logEvent } from "../log"
import { getUser } from "../repos/users"
import {
  getRequest,
  insertRequest,
  listByClient,
  listByHost,
  setStatus,
  toLike,
  type RequestRow,
} from "../repos/requests"
import { computeBookable } from "./schedule"

export type BookingErrorCode = "invalid" | "not_found" | "forbidden" | "slot_unavailable" | "overlapping_request" | "not_pending" | "expired"

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode, message: string) {
    super(message)
  }
}

export const MESSAGE_MAX = 500

export interface RequestView {
  id: string
  clientId: string
  clientName: string
  hostId: string
  hostName: string
  startMs: number
  endMs: number
  placeName: string
  meetingTypeName: string
  message: string
  status: RequestRow["status"] | "expired"
  label: string
}

/** Booking decisions read both calendars and then write; one lock serializes them, as SQLite's single writer did. */
async function bookingTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('booking'))`)
    return fn(tx)
  })
}

export async function createRequest(
  db: Db,
  input: { clientId: string; hostId: string; startMs: number; placeId: string; meetingTypeId: string; message: string },
  nowMs: number,
): Promise<RequestRow> {
  const message = input.message.trim()
  if (message.length === 0 || message.length > MESSAGE_MAX) throw new BookingError("invalid", `메시지는 1~${MESSAGE_MAX}자로 입력해 주세요`)
  if (input.clientId === input.hostId) throw new BookingError("invalid", "자기 자신에게는 요청할 수 없어요")

  const created = await bookingTx(db, async (tx) => {
    const { slots } = await computeBookable(tx, input.clientId, input.hostId, nowMs)
    const slot = slots.find((s) => sameSlot(s, { startMs: input.startMs, placeId: input.placeId, meetingTypeId: input.meetingTypeId }))
    if (!slot) throw new BookingError("slot_unavailable", "선택한 시간은 더 이상 가능하지 않아요. 대화로 돌아가 다시 골라 주세요")
    const own = (await listByClient(tx, input.clientId)).map(toLike)
    if (overlapsOwnPending(own, slot, nowMs)) {
      throw new BookingError("overlapping_request", "이미 요청해 둔 다른 미팅과 시간이 겹쳐요")
    }
    return insertRequest(tx, { ...input, message, endMs: slot.endMs }, nowMs)
  })
  logEvent("request.created", { requestId: created.id, clientId: input.clientId, hostId: input.hostId })
  return created
}

export async function withdrawRequest(db: Db, requestId: string, clientId: string, nowMs: number): Promise<void> {
  await bookingTx(db, async (tx) => {
    const req = await getRequest(tx, requestId)
    if (!req) throw new BookingError("not_found", "요청을 찾을 수 없어요")
    if (req.clientId !== clientId) throw new BookingError("forbidden", "내 요청만 철회할 수 있어요")
    if (req.status !== "pending") throw new BookingError("not_pending", "대기 중인 요청만 철회할 수 있어요")
    await setStatus(tx, requestId, "withdrawn", nowMs)
  })
  logEvent("request.withdrawn", { requestId })
}

export async function declineRequest(db: Db, requestId: string, hostId: string, nowMs: number): Promise<void> {
  await bookingTx(db, async (tx) => {
    const req = await getRequest(tx, requestId)
    if (!req) throw new BookingError("not_found", "요청을 찾을 수 없어요")
    if (req.hostId !== hostId) throw new BookingError("forbidden", "내가 받은 요청만 처리할 수 있어요")
    if (req.status !== "pending") throw new BookingError("not_pending", "이미 처리된 요청이에요")
    await setStatus(tx, requestId, "declined", nowMs)
  })
  logEvent("request.declined", { requestId, hostId })
}

/** Accept: revalidate, mark accepted, auto-decline overlapping pending requests, add both calendars. One transaction. */
export async function acceptRequest(db: Db, requestId: string, hostId: string, nowMs: number): Promise<{ declinedIds: string[] }> {
  const result = await bookingTx(db, async (t) => {
    const req = await getRequest(t, requestId)
    if (!req) throw new BookingError("not_found", "요청을 찾을 수 없어요")
    if (req.hostId !== hostId) throw new BookingError("forbidden", "내가 받은 요청만 처리할 수 있어요")
    if (req.status !== "pending") throw new BookingError("not_pending", "이미 처리된 요청이에요")
    const like = toLike(req)
    if (isExpired(like, nowMs)) throw new BookingError("expired", "시작 시각이 지나 수락할 수 없어요")

    const { slots, places, meetingTypes } = await computeBookable(t, req.clientId, req.hostId, nowMs, 0)
    const target = { startMs: like.startMs, placeId: req.placeId, meetingTypeId: req.meetingTypeId }
    if (!slots.some((s) => sameSlot(s, target))) {
      throw new BookingError("slot_unavailable", "그 사이 일정이 바뀌어 이 시간에는 만날 수 없어요")
    }

    await setStatus(t, req.id, "accepted", nowMs)
    const declinedIds = autoDeclineIds(like, (await listByHost(t, hostId)).map(toLike))
    for (const id of declinedIds) await setStatus(t, id, "declined", nowMs)

    const place = places.find((p) => p.id === req.placeId)
    const type = meetingTypes.find((m) => m.id === req.meetingTypeId)
    const online = place?.kind === "online"
    const kind = online ? "online" : "place"
    const placeRef = online ? null : (place?.id ?? null)
    const host = await getUser(t, req.hostId)
    const client = await getUser(t, req.clientId)
    const what = type?.name ?? "미팅"
    await addEvent(t, req.hostId, { title: `미팅: ${client?.name ?? "클라이언트"} · ${what}`, startMs: like.startMs, endMs: like.endMs, kind, placeRef, source: "booking", requestId: req.id })
    await addEvent(t, req.clientId, { title: `미팅: ${host?.name ?? "호스트"} · ${what}`, startMs: like.startMs, endMs: like.endMs, kind, placeRef, source: "booking", requestId: req.id })
    return { declinedIds }
  })
  logEvent("request.accepted", { requestId, hostId, autoDeclined: result.declinedIds.length })
  return result
}

async function toView(db: Db, r: RequestRow, nowMs: number): Promise<RequestView> {
  const { places, meetingTypes } = await computeNames(db, r.hostId)
  const startMs = Date.parse(r.startAt)
  const placeName = places.get(r.placeId) ?? "(삭제된 장소)"
  const typeName = meetingTypes.get(r.meetingTypeId) ?? "(삭제된 양식)"
  return {
    id: r.id,
    clientId: r.clientId,
    clientName: (await getUser(db, r.clientId))?.name ?? r.clientId,
    hostId: r.hostId,
    hostName: (await getUser(db, r.hostId))?.name ?? r.hostId,
    startMs,
    endMs: Date.parse(r.endAt),
    placeName,
    meetingTypeName: typeName,
    message: r.message,
    status: isExpired(toLike(r), nowMs) ? "expired" : r.status,
    label: `${formatKstDateTime(startMs)} · ${placeName} · ${typeName}`,
  }
}


async function computeNames(db: Db, hostId: string) {
  return {
    places: new Map((await listPlaces(db, hostId)).map((p) => [p.id, p.name])),
    meetingTypes: new Map((await listMeetingTypes(db, hostId)).map((m) => [m.id, m.name])),
  }
}

export async function sentRequests(db: Db, clientId: string, nowMs: number): Promise<RequestView[]> {
  return Promise.all((await listByClient(db, clientId)).map((r) => toView(db, r, nowMs)))
}

/** Host inbox: pending requests grouped by overlapping time, plus the already-decided ones. */
export async function inbox(db: Db, hostId: string, nowMs: number): Promise<{ pendingGroups: RequestView[][]; accepted: RequestView[]; declined: RequestView[]; expired: RequestView[] }> {
  const views = await Promise.all((await listByHost(db, hostId)).map((r) => toView(db, r, nowMs)))
  const pending = views.filter((v) => v.status === "pending").map((v) => ({ ...v, status: "pending" as const }))
  return {
    pendingGroups: groupOverlapping(pending),
    accepted: views.filter((v) => v.status === "accepted"),
    declined: views.filter((v) => v.status === "declined" || v.status === "withdrawn"),
    expired: views.filter((v) => v.status === "expired"),
  }
}

export async function pendingCount(db: Db, hostId: string, nowMs: number): Promise<number> {
  return (await listByHost(db, hostId)).filter((r) => r.status === "pending" && !isExpired(toLike(r), nowMs)).length
}
