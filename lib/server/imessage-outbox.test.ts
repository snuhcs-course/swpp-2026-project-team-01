import { describe, expect, it } from "vitest";
import type { SlotPreview } from "../contracts/slot-preview";
import { contentOf } from "./imessage-outbox";

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
  it.each(["imessage", "whatsapp", "telegram"] as const)("passes the slot preview on %s through as an image", (channel) => {
    expect(contentOf(row(channel), JSON.stringify({ language: "en", preview }), false)).toEqual({ kind: "image", language: "en", preview });
  });
});
