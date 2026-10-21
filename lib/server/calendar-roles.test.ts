import { describe, expect, it } from "vitest";
import { isWritable, recommendCalendarRoles } from "./calendar-roles";
import type { CalendarListEntry } from "./google-calendar";

function calendar(id: string, accessRole: string, extra: Partial<CalendarListEntry> = {}): CalendarListEntry {
  return { accessRole, id, summary: id, timeZone: "Asia/Seoul", ...extra };
}

describe("recommendCalendarRoles", () => {
  it("recommends the host's own and shared calendars and the primary as destination", () => {
    const recommendation = recommendCalendarRoles([
      calendar("me@example.test", "owner", { primary: true }),
      calendar("team@group.calendar.google.com", "reader"),
      calendar("shared@group.calendar.google.com", "writer"),
      calendar("en.south_korea#holiday@group.v.calendar.google.com", "reader"),
      calendar("addressbook#contacts@group.v.calendar.google.com", "reader"),
      calendar("busy-only@example.test", "freeBusyReader"),
    ]);

    expect(recommendation.conflict.map((entry) => entry.id)).toEqual([
      "me@example.test",
      "team@group.calendar.google.com",
      "shared@group.calendar.google.com",
    ]);
    expect(recommendation.conflict.every((entry) => entry.reason.length > 0)).toBe(true);
    expect(recommendation.booking).toEqual({ id: "me@example.test", reason: expect.stringContaining("main calendar") });
  });

  it("falls back to an owned, then a writable calendar when the primary cannot be written", () => {
    expect(
      recommendCalendarRoles([
        calendar("primary@example.test", "reader", { primary: true }),
        calendar("writer@group.calendar.google.com", "writer"),
        calendar("owner@group.calendar.google.com", "owner"),
      ]).booking?.id,
    ).toBe("owner@group.calendar.google.com");

    expect(
      recommendCalendarRoles([calendar("writer@group.calendar.google.com", "writer")]).booking?.id,
    ).toBe("writer@group.calendar.google.com");
  });

  it("recommends no destination when nothing is writable", () => {
    expect(recommendCalendarRoles([calendar("team@group.calendar.google.com", "reader")]).booking).toBeNull();
  });
});

describe("isWritable", () => {
  it("accepts only owner and writer", () => {
    expect(["owner", "writer", "reader", "freeBusyReader"].map((accessRole) => isWritable({ accessRole }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
