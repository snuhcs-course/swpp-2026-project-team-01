import { describe, expect, it } from "vitest";
import type { SlotPreview } from "../contracts/slot-preview";
import { contentOf, imessageTurnText, TURN_FALLBACK } from "./imessage-outbox";

// What an outbox row asks its transport to send (issue #211): the slot preview
// is the timetable image on every channel, Telegram included, so each transport
// sends the PNG with its caption.

const preview: SlotPreview = {
  days: [{ date: "2026-11-16", open: [{ end: "12:00", start: "10:00" }], weekday: "monday" }],
  durationMinutes: 30,
  grid: { end: "22:00", start: "09:00" },
  meetingMode: "online",
  place: null,
  reviewRef: "AB12CD",
  timezone: "Asia/Seoul",
  travelMode: null,
  weekStart: "2026-11-16",
};

const row = (channel: "imessage" | "whatsapp" | "telegram") => ({ buttons: null, channel, dedupe_key: "onboarding-preview:x", kind: "image" as const, template_name: null });

describe("contentOf", () => {
  it.each(["imessage", "whatsapp", "telegram"] as const)("opens a schedule image on %s as the picture alone", (channel) => {
    const schedule = { days: [], from: "2026-11-23", googleCalendar: "read", grid: { end: "18:00", start: "09:00" }, through: "2026-11-29", timezone: "Asia/Seoul" };
    const scheduleRow = { buttons: null, channel, dedupe_key: "schedule-image:b:c", kind: "schedule_image" as const, template_name: null };
    expect(contentOf(scheduleRow, JSON.stringify(schedule), true)).toEqual({ kind: "schedule_image", schedule });
  });

  it.each(["imessage", "whatsapp", "telegram"] as const)("passes the slot preview on %s through as an image", (channel) => {
    expect(contentOf(row(channel), JSON.stringify({ language: "en", preview }), false)).toEqual({ kind: "image", language: "en", preview });
  });
});

// A turn reply on iMessage, WhatsApp or Telegram never starts with a channel marker (#410).
describe("imessageTurnText", () => {
  it("drops a leading channel marker, and falls back when nothing else is left", () => {
    expect(imessageTurnText("[Telegram] [iMessage] Booked for Friday.", "https://findmeatime.com")).toBe("Booked for Friday.");
    expect(imessageTurnText("[WhatsApp] ", "https://findmeatime.com", "requester")).toBe(TURN_FALLBACK);
  });
});
