import { describe, expect, it } from "vitest";
import { authoredMessages, AUTHORED_TEXT } from "./authored-messages";
import {
  accessLabel,
  checkRange,
  copyDay,
  emptyRows,
  formatWindow,
  handleMessage,
  normalizeClock,
  parseMinutes,
  rowsFromWindows,
  sourceBadgeText,
  storageKey,
  summarizeWindows,
  topSlots,
  validateRows,
  weeklyPreview,
} from "./format";

// What the setup cards show and what their editors let through.

describe("source badges", () => {
  it("names the sample only for an inference", () => {
    expect(sourceBadgeText("inferred", 12)).toBe("Inferred · 12 meetings");
    expect(sourceBadgeText("inferred", 1)).toBe("Inferred · 1 meeting");
    expect(sourceBadgeText("inferred", null)).toBe("Inferred");
    expect(sourceBadgeText("stated")).toBe("Stated");
  });

  it("never describes a starter default as observed, even with a sample", () => {
    expect(sourceBadgeText("starter_default", 2)).toBe("Starter default");
  });
});

describe("weekly windows", () => {
  it("marks an end before its start as the next day", () => {
    expect(formatWindow({ end: "02:00", start: "22:00" })).toBe("22:00 – 02:00 (next day)");
    expect(formatWindow({ end: "17:00", start: "09:00" })).toBe("09:00 – 17:00");
  });

  it("previews seven rows from Monday, keeping an overnight window on its start day", () => {
    const rows = weeklyPreview([
      { end: "02:00", start: "22:00", weekday: "friday" },
      { end: "12:00", start: "10:00", weekday: "monday" },
      { end: "09:00", start: "08:00", weekday: "monday" },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(rows[0]!.ranges).toEqual(["08:00 – 09:00", "10:00 – 12:00"]);
    expect(rows[4]!.ranges).toEqual(["22:00 – 02:00 (next day)"]);
    expect(rows[5]!.ranges).toEqual([]);
    expect(summarizeWindows([{ end: "17:00", start: "09:00", weekday: "tuesday" }])).toBe("Tue 09:00 – 17:00");
  });

  it("rejects equal start and end, and malformed clocks, without blocking a next-day end", () => {
    expect(checkRange({ end: "09:00", start: "09:00" })).toEqual({
      error: "A window can't start and end at the same time.",
      nextDay: false,
    });
    expect(checkRange({ end: "9:00", start: "08:00" }).error).toBe("Use a 24-hour time such as 09:30.");
    expect(checkRange({ end: "24:00", start: "08:00" }).error).toBe("Use a 24-hour time such as 09:30.");
    expect(checkRange({ end: "01:00", start: "23:00" })).toEqual({ error: null, nextDay: true });
  });

  it("disables saving while any range is invalid or no window is left", () => {
    expect(validateRows(emptyRows()).error).toBe("Add at least one window.");

    const invalid = rowsFromWindows([
      { end: "17:00", start: "09:00", weekday: "monday" },
      { end: "10:00", start: "10:00", weekday: "tuesday" },
    ]);
    expect(validateRows(invalid).error).toBe("Fix the highlighted times before saving.");

    const valid = validateRows(rowsFromWindows([{ end: "02:00", start: "22:00", weekday: "friday" }]));
    expect(valid).toEqual({ error: null, windows: [{ end: "02:00", start: "22:00", weekday: "friday" }] });
  });

  it("caps a week at 21 windows", () => {
    const rows = { ...emptyRows(), monday: Array.from({ length: 22 }, () => ({ end: "10:00", start: "09:00" })) };
    expect(validateRows(rows).error).toBe("Use at most 21 windows in a week.");
  });

  it("copies a day to the weekdays or to every day, replacing their ranges", () => {
    const rows = rowsFromWindows([
      { end: "12:00", start: "09:00", weekday: "monday" },
      { end: "20:00", start: "18:00", weekday: "saturday" },
    ]);
    const weekdays = copyDay(rows, "monday", ["monday", "tuesday", "wednesday", "thursday", "friday"]);

    expect(weekdays.friday).toEqual([{ end: "12:00", start: "09:00" }]);
    expect(weekdays.saturday).toEqual([{ end: "20:00", start: "18:00" }]);
    expect(copyDay(rows, "monday", ["saturday", "sunday"]).sunday).toEqual([{ end: "12:00", start: "09:00" }]);
  });

  it("normalizes typed clocks once they can mean only one time", () => {
    expect(normalizeClock("9:30")).toBe("09:30");
    expect(normalizeClock("0930")).toBe("09:30");
    expect(normalizeClock("93")).toBe("93");
    expect(normalizeClock("09:3")).toBe("09:3");
    expect(normalizeClock("ab12:00")).toBe("12:00");
  });
});

describe("labels", () => {
  it("labels calendar access as the card shows it", () => {
    expect(["owner", "writer", "reader", "freeBusyReader", "other"].map(accessLabel)).toEqual([
      "Owner",
      "Can edit",
      "View only",
      "Free/busy only",
      "Unknown access",
    ]);
  });

  it("explains each handle problem and nothing for an available handle", () => {
    expect(handleMessage("available")).toBeNull();
    expect(handleMessage("format")).toContain("lowercase");
    expect(handleMessage("reserved")).toContain("reserved");
    expect(handleMessage("taken")).toContain("someone else");
    expect(handleMessage("change_limit")).toContain("30 days");
  });

  it("parses minutes within bounds and steps", () => {
    expect(parseMinutes("45", 15, 240, 5)).toBe(45);
    expect(parseMinutes("47", 15, 240, 5)).toBeNull();
    expect(parseMinutes("10", 15, 240, 5)).toBeNull();
    expect(parseMinutes("", 0, 120)).toBeNull();
    expect(parseMinutes("1.5", 0, 120)).toBeNull();
    expect(parseMinutes("0", 0, 120)).toBe(0);
  });
});

describe("analysis summary", () => {
  it("lists the most frequent start slots with their shares", () => {
    const slots = topSlots(
      {
        cells: [
          { count: 2, hour: 14, weekday: "wednesday" },
          { count: 5, hour: 10, weekday: "tuesday" },
          { count: 1, hour: 9, weekday: "monday" },
          { count: 2, hour: 16, weekday: "thursday" },
        ],
        sampleSize: 10,
        spans: [],
      },
      3,
    );

    expect(slots).toEqual([
      { count: 5, label: "Tue 10:00", share: 50 },
      { count: 2, label: "Wed 14:00", share: 20 },
      { count: 2, label: "Thu 16:00", share: 20 },
    ]);
  });
});

describe("authored onboarding messages", () => {
  it("prompts a host without Calendar to connect and stops there", () => {
    const messages = authoredMessages({
      calendar: { calendars: null, connected: false, destinationLost: false, error: null, invalid: false, recommendations: null },
      nextAction: "connect_calendar",
    });
    expect(messages.map((message) => message.text)).toEqual([AUTHORED_TEXT.greeting, AUTHORED_TEXT.calendarPrompt]);
  });

  it("congratulates a verified connection and introduces the calendar step", () => {
    const messages = authoredMessages({
      calendar: { calendars: null, connected: true, destinationLost: false, error: null, invalid: false, recommendations: null },
      nextAction: "choose_calendars",
    });
    expect(messages.map((message) => message.text)).toEqual([
      AUTHORED_TEXT.greeting,
      AUTHORED_TEXT.calendarConnected,
      AUTHORED_TEXT.chooseCalendars,
    ]);
  });

  it("keys browser storage by a hash, never the address itself", () => {
    const key = storageKey("host@example.test");
    expect(key).not.toContain("host");
    expect(key).toBe(storageKey("host@example.test"));
    expect(key).not.toBe(storageKey("other@example.test"));
  });
});
