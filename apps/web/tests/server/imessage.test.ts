import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"
import { makeContext } from "@/server/runtime"
import {
  getConnection, getMessageHistory, normalizePhotonPayload, processInboundBatch, processOutboundOne, retryConnection, startConnection,
  storeInbound, verifyPhotonSignature, WELCOME_TEXT, type PhotonInbound, type PhotonTransport,
} from "@/server/services/imessage"
import { all, one, run } from "@/server/db/client"
import { NOW, U, freshDb } from "./helpers"

const phone = "+14155550123"
const phone2 = "+14155550124"
function context(db: Awaited<ReturnType<typeof freshDb>>["db"], now = NOW, mode: "real" | "demo" = "real") {
  return makeContext(db, { now: () => now }, { mode, allowReset: mode === "demo" })
}
const inbound = (overrides: Partial<PhotonInbound> = {}): PhotonInbound => ({
  webhookId: "registered-webhook", eventType: "messages", messageId: "inbound-1", platform: "iMessage", direction: "inbound",
  senderId: phone, spaceId: "dm-1", spaceType: "dm", lineId: "+14155550000", contentType: "text", body: "I got your message",
  messageAt: NOW + 1, ...overrides,
})

describe("host iMessage phone connection", () => {
  it("queues once for the owner, masks the number, rejects demo, malformed and colliding numbers", async () => {
    const { db } = await freshDb(), ctx = context(db)
    const first = await startConnection(ctx, U.host, phone)
    const repeated = await startConnection(ctx, U.host, phone)
    expect(first).toMatchObject({ status: "pending", phone: "+14••••23", attempts: 1 })
    expect(repeated.id).toBe(first.id)
    expect(await all(db, "SELECT id FROM photon_outbound_attempts WHERE connection_id=?", [first.id])).toHaveLength(1)
    await expect(startConnection(ctx, U.host2, phone)).rejects.toMatchObject({ code: "revision_conflict" })
    await expect(startConnection(ctx, U.host, "+123")).rejects.toMatchObject({ code: "invalid_input" })
    await expect(startConnection(context(db, NOW, "demo"), U.jiho, "+14155550124")).rejects.toMatchObject({ code: "forbidden" })
  })

  it("creates the Photon conversation and line before send and records one accepted welcome", async () => {
    const { db } = await freshDb(), ctx = context(db)
    const queued = await startConnection(ctx, U.host, phone)
    let persisted = false
    const transport: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send(_number, conversationId, lineId, text) {
        const connection = await one<any>(db, "SELECT space_id,line_id FROM host_phone_connections WHERE id=?", [queued.id])
        persisted = connection.space_id === conversationId && connection.line_id === lineId
        expect(text).toContain("Find Me a Time")
        expect(text).toContain("reply")
        return { messageId: "welcome-1" }
      },
    }
    expect(await processOutboundOne(ctx, transport)).toBe(true)
    expect(persisted).toBe(true)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "sent", attempts: 1 })
    expect(await all(db, "SELECT message_id,body FROM host_imessage_messages WHERE connection_id=?", [queued.id])).toEqual([
      expect.objectContaining({ message_id: "welcome-1", body: WELCOME_TEXT }),
    ])
  })

  it("allows only cooled down definite failures to retry and locks uncertain sends", async () => {
    const { db } = await freshDb()
    let now = NOW
    const ctx = makeContext(db, { now: () => now }, { mode: "real", allowReset: false })
    await startConnection(ctx, U.host, phone)
    const openingFailure: PhotonTransport = {
      async open() { throw new Error("provider rejected") }, async send() { throw new Error("not reached") },
    }
    await processOutboundOne(ctx, openingFailure)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "failed", attempts: 1, failure: "provider_rejected" })
    expect((await retryConnection(ctx, U.host)).attempts).toBe(1)
    now += 60_001
    expect(await retryConnection(ctx, U.host)).toMatchObject({ status: "pending", attempts: 2 })
    const uncertain: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { throw new Error("network timeout") },
    }
    await processOutboundOne(ctx, uncertain)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "uncertain", attempts: 2 })
    now += 60_001
    expect((await retryConnection(ctx, U.host)).status).toBe("uncertain")
    expect(await one(db, "SELECT status FROM photon_outbound_attempts WHERE connection_id=? ORDER BY attempt_no DESC LIMIT 1", [(await getConnection(ctx, U.host))!.id])).toMatchObject({ status: "uncertain" })
  })

  it("refuses a recipient whose resolved service is SMS/RCS and expires claims", async () => {
    const { db } = await freshDb()
    let now = NOW
    const ctx = makeContext(db, { now: () => now }, { mode: "real", allowReset: false })
    await startConnection(ctx, U.host, phone)
    const nonImessage: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "SMS" } },
      async send() { throw new Error("must not send") },
    }
    await processOutboundOne(ctx, nonImessage)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "failed", failure: "non_imessage_recipient" })
    now += 30 * 60_000 + 1
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "expired" })
  })

  it("enforces the three-attempt ceiling and does not silently replace a connected number", async () => {
    const { db } = await freshDb()
    let now = NOW
    const ctx = makeContext(db, { now: () => now }, { mode: "real", allowReset: false })
    const queued = await startConnection(ctx, U.host, phone)
    const rejected: PhotonTransport = { async open() { throw new Error("provider rejected") }, async send() { throw new Error("unreachable") } }
    for (let attempt = 1; attempt <= 3; attempt++) {
      await processOutboundOne(ctx, rejected)
      expect(await getConnection(ctx, U.host)).toMatchObject({ status: "failed", attempts: attempt })
      now += 60_001
      if (attempt < 3) await retryConnection(ctx, U.host)
    }
    expect(await retryConnection(ctx, U.host)).toMatchObject({ status: "failed", attempts: 3 })
    const opened: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { return { messageId: "welcome-1" } },
    }
    expect(queued.status).toBe("pending")
    const connected = await startConnection(ctx, U.host2, phone2)
    await processOutboundOne(ctx, opened)
    await storeInbound(db, inbound({ messageId: "host2-reply", senderId: phone2 }), now + 1)
    await processInboundBatch(db, now + 2)
    expect(await getConnection(ctx, U.host2)).toMatchObject({ status: "connected" })
    await expect(startConnection(ctx, U.host2, "+14155550125")).rejects.toMatchObject({ code: "revision_conflict" })
    expect(connected.status).toBe("pending")
  })

  it("does not reclaim an interrupted send as a fresh delivery after worker restart", async () => {
    const { db } = await freshDb()
    let now = NOW
    const ctx = makeContext(db, { now: () => now }, { mode: "real", allowReset: false })
    const connection = await startConnection(ctx, U.host, phone)
    await run(db, "UPDATE photon_outbound_attempts SET status='sending',updated_at=? WHERE connection_id=?", [NOW,connection.id])
    now += 6 * 60_000
    let sendCalls = 0
    const transport: PhotonTransport = {
      async open() { sendCalls++; return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { sendCalls++; return { messageId: "unexpected" } },
    }
    expect(await processOutboundOne(ctx, transport)).toBe(false)
    expect(sendCalls).toBe(0)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "uncertain" })
  })

  it("claims a queued job only once when two worker iterations overlap", async () => {
    const { db } = await freshDb(), ctx = context(db)
    await startConnection(ctx, U.host, phone)
    let sends = 0
    const transport: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { sends++; await new Promise((resolve) => setTimeout(resolve, 20)); return { messageId: "welcome-1" } },
    }
    const results = await Promise.all([processOutboundOne(ctx, transport), processOutboundOne(ctx, transport)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(sends).toBe(1)
    expect(await all(db, "SELECT status FROM photon_outbound_attempts")).toEqual([expect.objectContaining({ status: "sent" })])
  })
})

describe("Photon signed inbox and matching", () => {
  it("verifies raw bytes, rejects stale signatures and normalizes the documented payload", () => {
    const secret = "test-only-secret", timestamp = String(Math.floor(NOW / 1000))
    const raw = Buffer.from('{ "event":"messages", "message":{} }')
    const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(raw).digest("hex")}`
    expect(verifyPhotonSignature(raw, secret, signature, timestamp, NOW)).toBe(true)
    expect(verifyPhotonSignature(raw, secret, signature, String(Number(timestamp) - 400), NOW)).toBe(false)
    expect(verifyPhotonSignature(Buffer.from("{}"), secret, signature, timestamp, NOW)).toBe(false)
    const event = normalizePhotonPayload({ event: "messages", space: { id: "dm-1", platform: "iMessage", type: "dm", phone: "+14155550000" },
      message: { id: "m1", platform: "iMessage", direction: "inbound", timestamp: new Date(NOW).toISOString(), sender: { id: phone },
        space: { id: "dm-1", platform: "iMessage", type: "dm", phone: "+14155550000" }, content: { type: "text", text: "hello" } } }, "registered-webhook", "messages")
    expect(event).toMatchObject({ senderId: phone, spaceId: "dm-1", lineId: "+14155550000", body: "hello" })
    expect(normalizePhotonPayload({ event: "messages", message: { id: "m1" } }, "id", "something_else")).toBeNull()
  })

  it("dedupes receipt, connects only matching DM sender and line, retains matched history, discards unknown bodies", async () => {
    const { db } = await freshDb(), ctx = context(db)
    const connection = await startConnection(ctx, U.host, phone)
    const transport: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { return { messageId: "welcome-1" } },
    }
    await processOutboundOne(ctx, transport)
    const event = inbound()
    expect(await storeInbound(db, event, NOW + 2)).toBe(true)
    expect(await storeInbound(db, event, NOW + 3)).toBe(false)
    await storeInbound(db, inbound({ messageId: "wrong-line", lineId: "+14155559999", body: "private unmatched body" }), NOW + 4)
    await storeInbound(db, inbound({ messageId: "group", spaceType: "group", body: "group text" }), NOW + 5)
    expect(await processInboundBatch(db, NOW + 6)).toBe(3)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "connected" })
    expect(await all(db, "SELECT direction,message_id FROM host_imessage_messages WHERE connection_id=? ORDER BY direction", [connection.id])).toEqual([
      expect.objectContaining({ direction: "inbound", message_id: "inbound-1" }),
      expect.objectContaining({ direction: "outbound", message_id: "welcome-1" }),
    ])
    expect(await one<any>(db, "SELECT status,body FROM photon_inbound_events WHERE message_id='wrong-line'")).toMatchObject({ status: "ignored", body: null })
    expect(await one<any>(db, "SELECT status,body FROM photon_inbound_events WHERE message_id='group'")).toMatchObject({ status: "ignored", body: null })
    const history = await getMessageHistory(db, U.host)
    expect(history).toHaveLength(2)
    expect(history.map((message: any) => message.direction)).toEqual(["outbound", "inbound"])
    expect(await getMessageHistory(db, U.host2)).toHaveLength(0)
    await storeInbound(db, inbound({ messageId: "later-message", body: "later reply", messageAt: NOW + 2_000_000 }), NOW + 2_000_000)
    await processInboundBatch(db, NOW + 2_000_001)
    expect(await one<any>(db, "SELECT body FROM host_imessage_messages WHERE message_id='later-message'")).toMatchObject({ body: "later reply" })
  })

  it("rejects wrong conversation and expired pending replies without keeping their body", async () => {
    const { db } = await freshDb(), ctx = context(db)
    await startConnection(ctx, U.host, phone)
    await storeInbound(db, inbound({ messageId: "wrong-space", spaceId: "other-dm" }), NOW + 1)
    await processInboundBatch(db, NOW + 2)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "pending" })
    expect(await one<any>(db, "SELECT status,body FROM photon_inbound_events WHERE message_id='wrong-space'")).toMatchObject({ status: "ignored", body: null })
  })

  it("discards unknown senders and never attributes another phone to the host", async () => {
    const { db } = await freshDb(), ctx = context(db)
    const queued = await startConnection(ctx, U.host, phone)
    const transport: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { return { messageId: "welcome-1" } },
    }
    await processOutboundOne(ctx, transport)
    await storeInbound(db, inbound({ messageId: "unknown-sender", senderId: "+14155550999", body: "do not retain" }), NOW + 1)
    await processInboundBatch(db, NOW + 2)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "sent" })
    expect(await one<any>(db, "SELECT status,body FROM photon_inbound_events WHERE message_id='unknown-sender'")).toMatchObject({ status: "ignored", body: null })
    expect(await all(db, "SELECT id FROM host_imessage_messages WHERE host_id=? AND direction='inbound'", [U.host])).toHaveLength(0)
    expect(await one<any>(db, "SELECT id FROM host_phone_connections WHERE id=?", [queued.id])).toBeTruthy()
  })

  it("does not connect a reply sent after the pending phone claim expires", async () => {
    const { db } = await freshDb()
    let now = NOW
    const ctx = makeContext(db, { now: () => now }, { mode: "real", allowReset: false })
    await startConnection(ctx, U.host, phone)
    const transport: PhotonTransport = {
      async open() { return { conversationId: "dm-1", lineId: "+14155550000", recipientService: "iMessage" } },
      async send() { return { messageId: "welcome-1" } },
    }
    await processOutboundOne(ctx, transport)
    now += 30 * 60_000 + 1
    await storeInbound(db, inbound({ messageId: "late-reply", messageAt: now }), now)
    await processInboundBatch(db, now + 1)
    expect(await getConnection(ctx, U.host)).toMatchObject({ status: "expired" })
    expect(await one<any>(db, "SELECT status,body FROM photon_inbound_events WHERE message_id='late-reply'")).toMatchObject({ status: "ignored", body: null })
  })
})
