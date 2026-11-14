import { describe, expect, it } from "vitest";
import type { NoteExclusion } from "./feasibility";
import { exclusionAnswer, MAX_NOTE_EXCLUSIONS, noteAnswerMatcher, withNoteExclusion, withoutNoteExclusion } from "./note-answers";

const calendar = "host@example.test";

function occurrence(id: string, updated: string, recurringEventId: string | null = null, calendarId = calendar) {
  return { calendarId, id, recurringEventId, updated };
}

describe("noteAnswerMatcher", () => {
  it("matches an occurrence answer only while the event is not edited after it", () => {
    const matches = noteAnswerMatcher([{ calendarId: calendar, eventId: "gym", fingerprint: "2026-10-02T00:00:00.000Z", scope: "occurrence" }]);

    expect(matches(occurrence("gym", "2026-10-02T00:00:00.000Z"))).toBe(true);
    // Not edited after the answer, such as a scan read before our own writeback.
    expect(matches(occurrence("gym", "2026-10-01T00:00:00.000Z"))).toBe(true);
    expect(matches(occurrence("gym", "2026-10-09T00:00:00.000Z"))).toBe(false);
    expect(matches(occurrence("gym", "2026-10-02T00:00:00.000Z", null, "team@group.calendar.google.com"))).toBe(false);
    // An occurrence answer does not cover the rest of its series.
    expect(matches(occurrence("gym_20261020", "2026-10-02T00:00:00.000Z", "gym"))).toBe(false);
  });

  // A series kept busy, or freed on a calendar that cannot be changed, is not
  // asked about again although Google gives its occurrences different updated times.
  it("matches every occurrence of a series not edited after the answer", () => {
    const matches = noteAnswerMatcher([{ calendarId: calendar, eventId: "recycling", fingerprint: "2026-10-05T00:00:00.000Z", scope: "series" }]);

    expect(matches(occurrence("recycling_1", "2026-10-05T00:00:00.000Z", "recycling"))).toBe(true);
    expect(matches(occurrence("recycling_2", "2026-09-01T12:34:56.789Z", "recycling"))).toBe(true);
    // Edited after the answer: asked again.
    expect(matches(occurrence("recycling_3", "2026-10-05T00:00:01.000Z", "recycling"))).toBe(false);
    // Another series, or the same series ID on another calendar.
    expect(matches(occurrence("other_1", "2026-10-01T00:00:00.000Z", "other"))).toBe(false);
    expect(matches(occurrence("recycling_1", "2026-10-01T00:00:00.000Z", "recycling", "team@group.calendar.google.com"))).toBe(false);
    // A series answer names the series, never an event with that ID itself.
    expect(matches(occurrence("recycling", "2026-10-01T00:00:00.000Z"))).toBe(false);
  });

  it("reads an exclusion saved before series exclusions as one occurrence", () => {
    expect(exclusionAnswer({ calendarId: calendar, eventId: "note", fingerprint: "f" })).toEqual({
      calendarId: calendar,
      eventId: "note",
      fingerprint: "f",
      scope: "occurrence",
    });
  });
});

describe("note exclusions", () => {
  const now = new Date("2026-11-13T00:00:00.000Z");
  const entry = (eventId: string, end?: string): NoteExclusion => ({ calendarId: calendar, eventId, fingerprint: "f", ...(end ? { end } : {}) });

  it("replaces the exclusion of the same item and removes one", () => {
    const list = withNoteExclusion([entry("a"), entry("b")], { ...entry("a"), fingerprint: "g" }, now);
    expect(list).toEqual([entry("b"), { ...entry("a"), fingerprint: "g" }]);
    expect(withoutNoteExclusion(list, calendar, "b")).toEqual([{ ...entry("a"), fingerprint: "g" }]);
  });

  it("drops ended entries first, earliest end first, at the 200-entry limit", () => {
    const full = Array.from({ length: MAX_NOTE_EXCLUSIONS }, (_, index) => entry(`future-${index}`, "2027-01-01"));
    full[10] = entry("ended-late", "2026-11-01T10:00:00.000Z");
    full[20] = entry("ended-early", "2026-10-01");

    const once = withNoteExclusion(full, entry("new", "2026-12-24"), now);
    expect(once).toHaveLength(MAX_NOTE_EXCLUSIONS);
    expect(once.map((item) => item.eventId)).not.toContain("ended-early");
    expect(once.map((item) => item.eventId)).toContain("ended-late");
    expect(once.at(-1)!.eventId).toBe("new");

    const twice = withNoteExclusion(once, entry("newer", "2026-12-25"), now);
    expect(twice.map((item) => item.eventId)).not.toContain("ended-late");
  });

  it("drops the oldest entries when none has ended, never the new one", () => {
    const full = Array.from({ length: MAX_NOTE_EXCLUSIONS }, (_, index) => entry(`future-${index}`));
    const list = withNoteExclusion(full, entry("new"), now);

    expect(list).toHaveLength(MAX_NOTE_EXCLUSIONS);
    expect(list[0]!.eventId).toBe("future-1");
    expect(list.at(-1)!.eventId).toBe("new");
  });
});
