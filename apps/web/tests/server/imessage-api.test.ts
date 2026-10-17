import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DomainError } from "@/contracts/common"
import { freshDb, U } from "./helpers"

const mocks = vi.hoisted(() => ({ db: null as any, requireActor: vi.fn() }))
vi.mock("@/server/context", () => ({ db: () => mocks.db }))
vi.mock("@/server/session", () => ({ requireActor: mocks.requireActor }))

import { GET, POST } from "@/app/api/host/imessage/connection/route"

function post(phone: string) {
  return new Request("https://app.example/api/host/imessage/connection", {
    method: "POST", headers: { origin: "https://app.example", "content-type": "application/json" }, body: JSON.stringify({ phone }),
  })
}
const get = () => new Request("https://app.example/api/host/imessage/connection")

describe("host iMessage connection API", () => {
  beforeEach(async () => {
    mocks.db = (await freshDb()).db
    mocks.requireActor.mockReset()
    mocks.requireActor.mockResolvedValue({ id: U.host, name: "Host", mode: "real" })
    vi.stubEnv("APP_MODE", "real")
    vi.stubEnv("DATABASE_URL", "postgresql://unused")
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it("requires the existing authenticated actor and refuses an unauthenticated command", async () => {
    mocks.requireActor.mockRejectedValueOnce(new DomainError("unauthenticated", "로그인이 필요해요"))
    const response = await POST(post("+14155550123"))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "unauthenticated" } })
  })

  it("rejects demo mode and returns only the owner's masked connection status", async () => {
    vi.stubEnv("APP_MODE", "demo")
    mocks.requireActor.mockResolvedValueOnce({ id: U.host, name: "Host", mode: "demo" })
    expect((await POST(post("+14155550123"))).status).toBe(403)
    vi.stubEnv("APP_MODE", "real")
    expect((await POST(post("+14155550123"))).status).toBe(202)
    const other = await GET(new Request("https://app.example/api/host/imessage/connection"))
    expect(await other.json()).toMatchObject({ ok: true, data: { connection: { phone: "+14••••23", status: "pending" } } })
    mocks.requireActor.mockResolvedValueOnce({ id: U.host2, name: "Other", mode: "real" })
    const owner = await GET(get())
    expect(await owner.json()).toMatchObject({ ok: true, data: { connection: null } })
  })
})
