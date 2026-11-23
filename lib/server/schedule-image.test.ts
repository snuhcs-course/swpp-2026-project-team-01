import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduleImage } from "../contracts/schedule-image";
import { WEEKDAYS } from "../contracts/setup";
import { lanesOf, periodText, renderScheduleImagePng } from "./schedule-image";

// The schedule image (messenger-schedule-image design 3).

const schedule: ScheduleImage = {
  days: WEEKDAYS.map((weekday, i) => ({
    allDay: i === 2 ? [{ kind: "calendar_event", title: "Conference" }, { kind: "calendar_event", title: "Offsite" }, { kind: "calendar_event", title: "Holiday" }] : [],
    date: `2026-11-${23 + i}`,
    entries:
      i === 0
        ? [
            { end: "11:00", kind: "booked_meeting", start: "10:00", title: "Coffee with 박도현" },
            { end: "11:30", kind: "calendar_event", start: "10:30", title: "Standup ☕ 驛" },
            { end: "15:00", kind: "request_to_decide", start: "14:00", title: "Request from 이은우" },
          ]
        : i === 1
          ? [{ end: "24:00", kind: "sent_request", start: "21:00", title: "Call with Alex" }]
          : [],
    weekday,
  })),
  from: "2026-11-23",
  googleCalendar: "read",
  grid: { end: "24:00", start: "09:00" },
  through: "2026-11-29",
  timezone: "Asia/Seoul",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderScheduleImagePng", () => {
  it("renders the week as a PNG with the bundled fonts and no network", { timeout: 30_000 }, async () => {
    const network: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("data:")) return realFetch(input, init);
      network.push(url);
      return Promise.reject(new Error("no network in the schedule image"));
    });

    const png = await renderScheduleImagePng(schedule);
    if (process.env.SCHEDULE_IMAGE_OUT) await writeFile(process.env.SCHEDULE_IMAGE_OUT, png);

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
    expect(network).toEqual([]);
  });

  it("renders an empty day without Google Calendar", { timeout: 30_000 }, async () => {
    const png = await renderScheduleImagePng({
      ...schedule,
      days: [{ allDay: [], date: "2026-11-24", entries: [], weekday: "tuesday" }],
      from: "2026-11-24",
      googleCalendar: "unavailable",
      grid: { end: "18:00", start: "09:00" },
      through: "2026-11-24",
    });

    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });
});

describe("lanesOf", () => {
  it("puts overlapping entries side by side and reuses a free lane", () => {
    const entry = (start: string, end: string) => ({ end, kind: "calendar_event" as const, start, title: "x" });
    expect(lanesOf([entry("10:00", "11:00"), entry("10:30", "11:30"), entry("11:00", "12:00"), entry("14:00", "15:00")])).toEqual([
      { lane: 0, of: 2 },
      { lane: 1, of: 2 },
      { lane: 0, of: 2 },
      { lane: 0, of: 1 },
    ]);
    expect(lanesOf([])).toEqual([]);
  });
});

describe("periodText", () => {
  it("names one day, a week within a month and a week across months", () => {
    expect(periodText("2026-11-24", "2026-11-24")).toBe("Nov 24");
    expect(periodText("2026-11-23", "2026-11-29")).toBe("Nov 23–29");
    expect(periodText("2026-11-30", "2026-12-06")).toBe("Nov 30–Dec 6");
  });
});
