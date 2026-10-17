import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  Spectrum: vi.fn(), config: vi.fn(() => ({ provider: "imessage" })), platform: vi.fn(), user: vi.fn(), create: vi.fn(),
  get: vi.fn(), send: vi.fn(), stop: vi.fn(),
}))
vi.mock("spectrum-ts", () => ({ Spectrum: mocks.Spectrum }))
vi.mock("spectrum-ts/providers/imessage", () => ({ imessage: Object.assign(mocks.platform, { config: mocks.config }) }))

import { createSpectrumTransport } from "@/server/providers/spectrum-imessage"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.Spectrum.mockResolvedValue({ stop: mocks.stop })
  mocks.platform.mockReturnValue({ user: mocks.user, space: { create: mocks.create, get: mocks.get } })
  mocks.user.mockResolvedValue({ id: "+14155550123" })
  mocks.create.mockResolvedValue({ id: "dm-1", phone: "+14155550000" })
  mocks.get.mockResolvedValue({ send: mocks.send })
  mocks.send.mockResolvedValue({ id: "message-1" })
})

it("uses the managed iMessage provider, pins the chosen line, and sends through the stored DM", async () => {
  const transport = await createSpectrumTransport("project-id", "test-secret")
  expect(await transport.open("+14155550123", "+14155550000")).toEqual({
    conversationId: "dm-1", lineId: "+14155550000", recipientService: "unknown",
  })
  expect(mocks.Spectrum).toHaveBeenCalledWith({ projectId: "project-id", projectSecret: "test-secret", providers: [expect.anything()] })
  expect(mocks.create).toHaveBeenCalledWith({ id: "+14155550123" }, { phone: "+14155550000" })
  expect(await transport.send("+14155550123", "dm-1", "+14155550000", "hello")).toEqual({ messageId: "message-1" })
  expect(mocks.get).toHaveBeenCalledWith("dm-1", { phone: "+14155550000" })
  await transport.close?.()
  expect(mocks.stop).toHaveBeenCalledOnce()
})
