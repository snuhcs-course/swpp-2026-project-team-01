import { beforeEach, describe, expect, it } from "vitest"
import type { Db } from "@/server/db/client"
import { addEvent, listEvents } from "@/server/repos/events"
import { getRequest, listByHost } from "@/server/repos/requests"
import {
  BookingError,
  acceptRequest,
  createRequest,
  declineRequest,
  inbox,
  pendingCount,
  withdrawRequest,
} from "@/server/services/booking"
import { computeBookable } from "@/server/services/schedule"
import { MIN } from "../core/helpers"
import { NOW, U, firstOnlineSlot, freshDb } from "./helpers"

let db: Db
beforeEach(async () => {
  db = (await freshDb()).db
})

const code = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn()
    return null
  } catch (e) {
    return e instanceof BookingError ? e.code : "other"
  }
}

async function request(clientId: string, hostId: string, slot: { startMs: number; placeId: string; meetingTypeId: string }, message = "프로젝트 상담입니다", nowMs = NOW) {
  return createRequest(db, { clientId, hostId, startMs: slot.startMs, placeId: slot.placeId, meetingTypeId: slot.meetingTypeId, message }, nowMs)
}

describe("createRequest", () => {
  it("creates a pending request with the slot's end time and a trimmed message", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot, "  안녕하세요  ")
    expect(r.status).toBe("pending")
    expect(r.message).toBe("안녕하세요")
    expect(Date.parse(r.endAt)).toBe(slot.endMs)
  })

  it("rejects empty, too long, and self-addressed requests", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    expect(await code(() => request(U.jiho, U.host, slot, "   "))).toBe("invalid")
    expect(await code(() => request(U.jiho, U.host, slot, "가".repeat(501)))).toBe("invalid")
    expect(await code(() => request(U.jiho, U.host, slot, "가".repeat(500)))).toBeNull()
    expect(await code(() => request(U.host, U.host, slot))).toBe("invalid")
  })

  it("rejects a slot that is not bookable", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    expect(await code(() => request(U.jiho, U.host, { ...slot, startMs: slot.startMs + 5 * MIN }))).toBe("slot_unavailable")
    expect(await code(() => request(U.jiho, U.host, { ...slot, placeId: "nope" }))).toBe("slot_unavailable")
  })

  it("blocks a second pending request that overlaps in time, even to another host", async () => {
    const a = await firstOnlineSlot(db, U.jiho, U.host)
    await request(U.jiho, U.host, a.slot)
    const b = await firstOnlineSlot(db, U.jiho, U.host2, a.slot.startMs)
    expect(b.slot.startMs).toBe(a.slot.startMs) // both hosts are free at that time
    expect(await code(() => request(U.jiho, U.host2, b.slot))).toBe("overlapping_request")
  })

  it("allows touching requests and requests to the same host at different times", async () => {
    const a = await firstOnlineSlot(db, U.jiho, U.host)
    await request(U.jiho, U.host, a.slot)
    const next = (await computeBookable(db, U.jiho, U.host, NOW)).slots.find((s) => s.startMs === a.slot.endMs && s.placeId === a.slot.placeId && s.meetingTypeId === a.slot.meetingTypeId)!
    expect(await code(() => request(U.jiho, U.host, next))).toBeNull()
  })

  it("does not block a slot that another client already requested", async () => {
    const a = await firstOnlineSlot(db, U.jiho, U.host)
    await request(U.jiho, U.host, a.slot)
    const other = await firstOnlineSlot(db, U.hana, U.host, a.slot.startMs)
    expect(other.slot.startMs).toBe(a.slot.startMs)
    expect(await code(() => request(U.hana, U.host, other.slot))).toBeNull()
  })

  it("lets a declined or withdrawn request's time be requested again", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r1 = await request(U.jiho, U.host, slot)
    await declineRequest(db, r1.id, U.host, NOW)
    const r2 = await request(U.jiho, U.host, slot)
    await withdrawRequest(db, r2.id, U.jiho, NOW)
    expect(await code(() => request(U.jiho, U.host, slot))).toBeNull()
  })
})

describe("acceptRequest", () => {
  it("accepts one request, auto-declines the overlapping ones, and adds both calendars", async () => {
    const a = await firstOnlineSlot(db, U.jiho, U.host)
    const rJiho = await request(U.jiho, U.host, a.slot)
    const rHana = await request(U.hana, U.host, (await firstOnlineSlot(db, U.hana, U.host, a.slot.startMs)).slot)
    const { declinedIds } = await acceptRequest(db, rJiho.id, U.host, NOW)
    expect(declinedIds).toEqual([rHana.id])
    expect((await getRequest(db, rJiho.id))?.status).toBe("accepted")
    expect((await getRequest(db, rHana.id))?.status).toBe("declined")
    for (const uid of [U.host, U.jiho]) {
      const ev = (await listEvents(db, uid)).find((e) => e.requestId === rJiho.id)!
      expect(ev.source).toBe("booking")
      expect(ev.kind).toBe("online")
      expect(ev.startMs).toBe(a.slot.startMs)
      expect(ev.endMs).toBe(a.slot.endMs)
    }
    expect((await listEvents(db, U.hana)).some((e) => e.requestId)).toBe(false)
  })

  it("leaves non-overlapping pending requests alone", async () => {
    const a = await firstOnlineSlot(db, U.jiho, U.host)
    const r1 = await request(U.jiho, U.host, a.slot)
    const later = (await computeBookable(db, U.hana, U.host, NOW)).slots.find((s) => s.startMs >= a.slot.endMs + 3 * 60 * MIN && s.placeId === a.slot.placeId)!
    const r2 = await request(U.hana, U.host, later)
    await acceptRequest(db, r1.id, U.host, NOW)
    expect((await getRequest(db, r2.id))?.status).toBe("pending")
  })

  it("the accepted time is no longer bookable, and an offline meeting uses the place as its location", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    await acceptRequest(db, (await request(U.jiho, U.host, slot)).id, U.host, NOW)
    expect((await computeBookable(db, U.hana, U.host, NOW)).slots.some((s) => s.startMs === slot.startMs && s.meetingTypeId === slot.meetingTypeId)).toBe(false)

    const { slots, places } = await computeBookable(db, U.jiho, U.host, NOW)
    const near = places.find((p) => p.kind === "office_near")!
    const offline = slots.find((s) => s.placeId === near.id)!
    await acceptRequest(db, (await request(U.jiho, U.host, offline)).id, U.host, NOW)
    const ev = (await listEvents(db, U.host)).find((e) => e.startMs === offline.startMs && e.source === "booking")!
    expect(ev.kind).toBe("place")
    expect(ev.placeRef).toBe(near.id)
  })

  it("only the addressed host can accept or decline", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot)
    expect(await code(() => acceptRequest(db, r.id, U.host2, NOW))).toBe("forbidden")
    expect(await code(() => declineRequest(db, r.id, U.jiho, NOW))).toBe("forbidden")
    expect(await code(() => acceptRequest(db, "missing", U.host, NOW))).toBe("not_found")
  })

  it("cannot act twice on the same request", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot)
    await acceptRequest(db, r.id, U.host, NOW)
    expect(await code(() => acceptRequest(db, r.id, U.host, NOW))).toBe("not_pending")
    expect(await code(() => declineRequest(db, r.id, U.host, NOW))).toBe("not_pending")
  })

  it("refuses once the start time has passed", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot)
    expect(await code(() => acceptRequest(db, r.id, U.host, slot.startMs + MIN))).toBe("expired")
  })

  it("still accepts inside the 2-hour lead window, since the request was valid when made", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot)
    expect(await code(() => acceptRequest(db, r.id, U.host, slot.startMs - 30 * MIN))).toBeNull()
  })

  it("revalidates: a conflicting event added after the request blocks acceptance and changes nothing", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot)
    const other = await request(U.hana, U.host, (await firstOnlineSlot(db, U.hana, U.host, slot.startMs)).slot)
    await addEvent(db, U.host, { title: "급한 일", startMs: slot.startMs, endMs: slot.endMs, kind: "online", placeRef: null })
    expect(await code(() => acceptRequest(db, r.id, U.host, NOW))).toBe("slot_unavailable")
    expect((await getRequest(db, r.id))?.status).toBe("pending")
    expect((await getRequest(db, other.id))?.status).toBe("pending")
    expect((await listEvents(db, U.jiho)).some((e) => e.source === "booking")).toBe(false)
  })
})

describe("withdraw, inbox, pending count", () => {
  it("only the client can withdraw, and only while pending", async () => {
    const { slot } = await firstOnlineSlot(db, U.jiho, U.host)
    const r = await request(U.jiho, U.host, slot)
    expect(await code(() => withdrawRequest(db, r.id, U.hana, NOW))).toBe("forbidden")
    await withdrawRequest(db, r.id, U.jiho, NOW)
    expect((await getRequest(db, r.id))?.status).toBe("withdrawn")
    expect(await code(() => withdrawRequest(db, r.id, U.jiho, NOW))).toBe("not_pending")
  })

  it("groups the inbox by overlapping time and reports expired requests separately", async () => {
    const a = await firstOnlineSlot(db, U.jiho, U.host)
    await request(U.jiho, U.host, a.slot)
    await request(U.hana, U.host, (await firstOnlineSlot(db, U.hana, U.host, a.slot.startMs)).slot)
    const far = (await computeBookable(db, U.hana, U.host, NOW)).slots.find((s) => s.startMs >= a.slot.endMs + 24 * 60 * MIN)!
    await request(U.hana, U.host, far)
    expect(await pendingCount(db, U.host, NOW)).toBe(3)
    const box = await inbox(db, U.host, NOW)
    expect(box.pendingGroups.map((g) => g.length)).toEqual([2, 1])

    const later = await inbox(db, U.host, a.slot.endMs + MIN)
    expect(later.expired).toHaveLength(2)
    expect(later.pendingGroups.flat()).toHaveLength(1)
    expect(await pendingCount(db, U.host, a.slot.endMs + MIN)).toBe(1)
    expect(await listByHost(db, U.host)).toHaveLength(3)
  })
})
