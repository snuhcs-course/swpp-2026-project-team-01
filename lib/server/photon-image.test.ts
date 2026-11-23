import { beforeEach, expect, it, vi } from "vitest";
import type { ScheduleImage } from "../contracts/schedule-image";
import type { SlotPreview } from "../contracts/slot-preview";
import { channelReplies } from "./channel-texts";
import { spectrumTransport } from "./photon";

const wire = vi.hoisted(() => ({
  sent: [] as unknown[],
  png: Buffer.from("rendered-png"),
  render: vi.fn(),
  renderSchedule: vi.fn(),
}));
vi.mock("./slot-preview-image", () => ({ renderSlotPreviewPng: wire.render }));
vi.mock("./schedule-image", () => ({ renderScheduleImagePng: wire.renderSchedule }));
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
beforeEach(() => {
  wire.sent.length = 0;
  wire.render.mockReset().mockResolvedValue(wire.png);
  wire.renderSchedule.mockReset().mockResolvedValue(wire.png);
});

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

// The schedule image (messenger-schedule-image design 4): the picture alone, and nothing when it cannot be drawn.
const schedule: ScheduleImage = { days: [], from: "2026-11-23", googleCalendar: "read", grid: { end: "18:00", start: "09:00" }, through: "2026-11-29", timezone: "Asia/Seoul" };
const scheduleRequest = { recipient: { address: "+15550000000", spaceId: "space" }, content: { kind: "schedule_image" as const, schedule }, idempotencyKey: "schedule" };

it.each(["imessage", "whatsapp"] as const)("sends the schedule picture alone on %s", async (channel) => {
  expect(await transport.send({ ...scheduleRequest, channel })).toMatchObject({ messageId: "sent-image", status: "accepted" });
  expect(wire.renderSchedule).toHaveBeenCalledWith(schedule);
  expect(wire.sent).toEqual([{ buffer: wire.png, mimeType: "image/png", name: "schedule-2026-11-23.png" }]);
});
it.each(["imessage", "whatsapp"] as const)("sends nothing on %s when the schedule picture cannot be drawn", async (channel) => {
  wire.renderSchedule.mockRejectedValue(new Error("render failed"));
  expect(await transport.send({ ...scheduleRequest, channel })).toEqual({ category: "render_failed", status: "rejected" });
  expect(wire.sent).toEqual([]);
});
