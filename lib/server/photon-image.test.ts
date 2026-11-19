import { beforeEach, expect, it, vi } from "vitest";
import type { SlotPreview } from "../contracts/slot-preview";
import { channelReplies } from "./channel-texts";
import { spectrumTransport } from "./photon";

const wire = vi.hoisted(() => ({
  sent: [] as unknown[],
  png: Buffer.from("rendered-png"),
  render: vi.fn(),
}));
vi.mock("./slot-preview-image", () => ({ renderSlotPreviewPng: wire.render }));
vi.mock("@spectrum-ts/core", () => ({
  Spectrum: async () => ({ stop: async () => {} }),
  attachment: (buffer: Buffer, options: { mimeType: string; name: string }) => ({ buffer, ...options }),
  group: (...parts: unknown[]) => ({ parts }),
}));
const space = { id: "space", send: async (content: unknown) => { wire.sent.push(content); return { id: "sent-image" }; } };
vi.mock("@spectrum-ts/imessage", () => {
  const imessage = Object.assign(() => ({ space: { get: async () => space } }), { config: () => ({}) });
  return { imessage };
});
vi.mock("@spectrum-ts/whatsapp-business", () => {
  const whatsappBusiness = Object.assign(() => ({ user: async () => "user", space: { create: async () => space } }), { config: () => ({}) });
  return { whatsappBusiness };
});

const preview: SlotPreview = { timezone: "Asia/Seoul", weekStart: "2026-11-16", grid: { start: "10:00", end: "20:00" }, days: [], place: "강남역", meetingMode: "in_person", travelMode: "transit", durationMinutes: 30, reviewRef: "ABCD1234" };
const transport = spectrumTransport({ projectId: "test", projectSecret: "test" });
const request = { recipient: { address: "+15550000000", spaceId: "space" }, content: { kind: "image" as const, preview, language: "ko" as const }, idempotencyKey: "preview" };
beforeEach(() => { wire.sent.length = 0; wire.render.mockReset().mockResolvedValue(wire.png); });

it("sends the bare iMessage PNG then the preview message", async () => {
  expect(await transport.send({ ...request, channel: "imessage" })).toMatchObject({ status: "accepted" });
  expect(wire.sent).toEqual([{ buffer: wire.png, mimeType: "image/png", name: "slots-2026-11-16.png" }, channelReplies("ko").onboarding.slotSummary(preview)]);
});
it("sends the bare WhatsApp PNG then the preview message", async () => {
  expect(await transport.send({ ...request, channel: "whatsapp" })).toMatchObject({ status: "accepted" });
  expect(wire.sent).toEqual([{ buffer: wire.png, mimeType: "image/png", name: "slots-2026-11-16.png" }, channelReplies("ko").onboarding.slotSummary(preview)]);
});
it("keeps the iMessage summary readable when rendering fails", async () => {
  wire.render.mockRejectedValue(new Error("render failed"));
  expect(await transport.send({ ...request, channel: "imessage" })).toEqual({ status: "uncertain" });
  expect(wire.sent).toEqual([channelReplies("ko").onboarding.slotSummary(preview)]);
});
it("keeps the WhatsApp ranges readable when rendering fails, without acknowledging an image", async () => {
  wire.render.mockRejectedValue(new Error("render failed"));
  expect(await transport.send({ ...request, channel: "whatsapp" })).toEqual({ status: "uncertain" });
  expect(wire.sent).toEqual([channelReplies("ko").onboarding.slotSummary(preview)]);
});
