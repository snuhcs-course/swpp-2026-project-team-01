import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { freshDb } from "./helpers"

const mocks = vi.hoisted(() => ({ db: null as any, failPersistence: false }))
vi.mock("@/server/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db/client")>()
  return { ...original, getDb: () => mocks.failPersistence ? { transaction: async () => { throw new Error("db unavailable") } } : mocks.db, ensureBound: async () => {} }
})

import { POST } from "@/app/api/photon/webhook/route"
import { one } from "@/server/db/client"

const id = "registered-webhook", secret = "local-test-secret"
const rawBody = Buffer.from(JSON.stringify({ event: "messages", space: { id: "dm-id", platform: "iMessage", type: "dm", phone: "+14155550000" },
  message: { id: "message-id", platform: "iMessage", direction: "inbound", timestamp: "2026-10-18T00:00:00.000Z",
    sender: { id: "+14155550123", platform: "iMessage" }, space: { id: "dm-id", platform: "iMessage", type: "dm", phone: "+14155550000" },
    content: { type: "text", text: "reply" } } }))
function request(body = rawBody, at = Math.floor(Date.now() / 1000), sign = true) {
  const timestamp = String(at)
  const signature = sign ? `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(body).digest("hex")}` : ""
  return new Request("https://app.example/api/photon/webhook", { method: "POST", body,
    headers: { "content-type": "application/json", "x-spectrum-webhook-id": id, "x-spectrum-event": "messages",
      "x-spectrum-timestamp": timestamp, "x-spectrum-signature": signature },
  })
}

describe("Photon webhook receipt", () => {
  beforeEach(async () => {
    mocks.db = (await freshDb()).db
    mocks.failPersistence = false
    vi.stubEnv("SPECTRUM_WEBHOOK_ID", id)
    vi.stubEnv("SPECTRUM_WEBHOOK_SECRET", secret)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("persists before acknowledgement and dedupes repeated provider delivery", async () => {
    expect((await POST(request())).status).toBe(200)
    expect(await one<any>(mocks.db, "SELECT message_id,status,body FROM photon_inbound_events WHERE webhook_id=?", [id])).toMatchObject({ message_id: "message-id", status: "pending", body: "reply" })
    expect(await (await POST(request())).json()).toMatchObject({ ok: true, duplicate: true })
    expect(await one<any>(mocks.db, "SELECT count(*) AS n FROM photon_inbound_events")).toMatchObject({ n: 1 })
  })

  it("rejects unsigned, stale and malformed events", async () => {
    expect((await POST(request(rawBody, Math.floor(Date.now() / 1000), false))).status).toBe(400)
    expect((await POST(request(rawBody, Math.floor(Date.now() / 1000) - 600))).status).toBe(401)
    expect((await POST(request(Buffer.from("{")))).status).toBe(400)
    expect((await POST(new Request("https://app.example/api/photon/webhook", { method: "POST", body: rawBody,
      headers: { "x-spectrum-webhook-id": "wrong", "x-spectrum-event": "messages", "x-spectrum-timestamp": String(Math.floor(Date.now() / 1000)), "x-spectrum-signature": "v0=bad" } }))).status).toBe(400)
  })

  it("returns a retryable server error if durable persistence is unavailable", async () => {
    mocks.failPersistence = true
    expect((await POST(request())).status).toBe(503)
  })
})
