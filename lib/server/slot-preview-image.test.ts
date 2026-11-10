import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlotPreview } from "../contracts/slot-preview";
import { renderSlotPreviewPng } from "./slot-preview-image";

const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const preview: SlotPreview = {
  days: WEEK.map((weekday, i) => ({
    date: `2026-11-${16 + i}`,
    open: i < 5 ? [{ end: "12:00", start: "10:00" }, { end: "22:00", start: "14:30" }] : [],
    weekday,
  })),
  durationMinutes: 30,
  grid: { end: "22:00", start: "09:00" },
  meetingMode: "in_person",
  // Characters outside the bundled font (an emoji and Hanja) would make next/og
  // fetch glyphs from Google Fonts; they are dropped instead.
  place: "역삼동, 강남역 근처 ☕ 驛",
  reviewRef: "AB12CD",
  timezone: "Asia/Seoul",
  travelMode: "transit",
  weekStart: "2026-11-16",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderSlotPreviewPng", () => {
  it("renders the week as a PNG with the bundled fonts and no network", { timeout: 30_000 }, async () => {
    // The renderer loads its own WebAssembly from data: URLs; anything else is the network.
    const network: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("data:")) return realFetch(input, init);
      network.push(url);
      return Promise.reject(new Error("no network in the slot image"));
    });

    for (const language of ["ko", "en"] as const) {
      const png = await renderSlotPreviewPng(preview, language);

      expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
      // The IHDR chunk's width and height.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
    }
    expect(network).toEqual([]);
  });

  it("renders an online-only week with no open time", { timeout: 30_000 }, async () => {
    const png = await renderSlotPreviewPng(
      { ...preview, days: preview.days.map((day) => ({ ...day, open: [] })), meetingMode: "online", place: null, travelMode: null },
      "en",
    );

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });
});
