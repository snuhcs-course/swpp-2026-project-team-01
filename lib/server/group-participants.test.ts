import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "./google-calendar";
import { fingerprintOf, participantStep, unavailableTimes } from "./group-participants";

// A group participant's review (group-scheduling design 3 and 4).

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    attendees: [{ email: "boss@example.test", responseStatus: "accepted", self: false }],
    calendarId: "primary",
    end: { dateTime: "2026-11-02T13:00:00+09:00" },
    hasConferenceLink: false,
    iCalUID: null,
    id: "e1",
    location: "연세대학교 공학원",
    recurringEventId: null,
    start: { dateTime: "2026-11-02T12:00:00+09:00" },
    status: "confirmed",
    summary: "Salary talk",
    transparency: null,
    updated: null,
    description: "Bring the numbers",
    ...overrides,
  } as CalendarEvent;
}

const range = { end: new Date("2026-11-04T00:00:00+09:00"), start: new Date("2026-11-02T00:00:00+09:00") };

describe("the unavailable times a participant confirms", () => {
  it("keeps the time and place of an event, never its title, attendees or description", () => {
    const times = unavailableTimes([event({})], [], { range, selfEmail: "me@example.test", timezone: "Asia/Seoul" });
    const stored = JSON.stringify(times);

    expect(times).toEqual([
      expect.objectContaining({ allDay: false, place: "연세대학교 공학원", source: "calendar", start: "2026-11-02T03:00:00.000Z", end: "2026-11-02T04:00:00.000Z" }),
    ]);
    expect(stored).not.toContain("Salary");
    expect(stored).not.toContain("boss@example.test");
    expect(stored).not.toContain("numbers");
  });

  it("adds what they said, leaves out free and out-of-range events, and orders by start", () => {
    const times = unavailableTimes(
      [
        event({ id: "free", transparency: "transparent" }),
        event({ end: { dateTime: "2026-11-10T13:00:00+09:00" }, id: "later", start: { dateTime: "2026-11-10T12:00:00+09:00" } }),
        event({ end: { date: "2026-11-04" }, id: "allday", location: null, start: { date: "2026-11-03" } }),
      ],
      [{ allDay: false, end: "2026-11-02T18:00:00+09:00", start: "2026-11-02T14:00:00+09:00" }],
      { range, selfEmail: null, timezone: "Asia/Seoul" },
    );

    expect(times.map((time) => [time.source, time.start, time.allDay])).toEqual([
      ["stated", "2026-11-02T05:00:00.000Z", false],
      ["calendar", "2026-11-03", true],
    ]);
    expect(times[0]!.place).toBeNull();
  });

  it("fingerprints the list, so a changed calendar is not confirmed unseen", () => {
    const options = { range, selfEmail: null, timezone: "Asia/Seoul" };
    const before = fingerprintOf(unavailableTimes([event({})], [], options));

    expect(fingerprintOf(unavailableTimes([event({})], [], options))).toBe(before);
    expect(fingerprintOf(unavailableTimes([event({ location: "신촌역" })], [], options))).not.toBe(before);
    expect(fingerprintOf(unavailableTimes([], [], options))).not.toBe(before);
  });
});

describe("the participant's step", () => {
  const row = { answered_at: null, calendar_settled_at: new Date(), done_at: null, state: "gathering" };

  it("goes from the question to the review to done", () => {
    expect(participantStep({ ...row, calendar_settled_at: null })).toBeNull();
    expect(participantStep(row)).toBe("question");
    expect(participantStep({ ...row, answered_at: new Date() })).toBe("review");
    expect(participantStep({ ...row, answered_at: new Date(), done_at: new Date() })).toBe("done");
    expect(participantStep({ ...row, state: "expired" })).toBeNull();
  });
});
