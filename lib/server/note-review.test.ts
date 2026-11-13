import { describe, expect, it } from "vitest";
import type { AnalysisCard, AnalysisEvidence } from "../contracts/analysis";
import { buildNoteReview, weekBounds } from "./note-review";

type Entry = AnalysisEvidence["noteLike"]["entries"][number];

const HOST = "host@example.test";
const BIRTHDAYS = "birthdays@group.v.calendar.google.com";
const now = new Date("2026-11-13T00:00:00.000Z");

function entry(overrides: Partial<Entry>): Entry {
  return {
    allDay: false,
    calendarId: HOST,
    end: "2026-11-17T11:00:00.000Z",
    eventId: "event",
    fingerprint: "2026-10-01T00:00:00.000Z",
    seriesId: null,
    start: "2026-11-17T10:00:00.000Z",
    title: "Entry",
    ...overrides,
  };
}

function analysis(entries: Entry[], state: AnalysisCard["state"] = "completed"): AnalysisCard {
  return {
    calendars: [],
    completedAt: null,
    createdAt: now.toISOString(),
    evidence: { noteLike: { entries } } as unknown as AnalysisEvidence,
    failureCategory: null,
    id: "00000000-0000-4000-8000-000000000001",
    range: { end: now.toISOString(), start: now.toISOString() },
    state,
  };
}

const calendars = [
  { accessRole: "owner", id: HOST, summary: HOST },
  { accessRole: "reader", id: BIRTHDAYS, summary: "Birthdays" },
];

describe("buildNoteReview", () => {
  it("shows a series once, with its next occurrence and the latest fingerprint of its occurrences", () => {
    const { review, sources } = buildNoteReview({
      analysis: analysis([
        entry({ end: "2026-11-06T11:00:00.000Z", eventId: "r_1", fingerprint: "2026-10-05T00:00:00.000Z", seriesId: "r", start: "2026-11-06T10:00:00.000Z", title: "분리수거", verdict: "note" }),
        entry({ end: "2026-11-20T11:00:00.000Z", eventId: "r_3", fingerprint: "2026-09-01T00:00:00.000Z", seriesId: "r", start: "2026-11-20T10:00:00.000Z", title: "분리수거", verdict: "note" }),
        entry({ eventId: "r_2", fingerprint: "2026-10-01T00:00:00.000Z", seriesId: "r", title: "분리수거", verdict: "note" }),
        entry({ eventId: "gym", reason: "직접 시간을 쓰는 일정처럼 보여요.", start: "2026-11-15T10:00:00.000Z", title: "헬스", verdict: "event" }),
      ]),
      calendars,
      decisions: [],
      now,
    });

    expect(review.items.map((item) => [item.title, item.repeats, item.start])).toEqual([
      ["헬스", false, "2026-11-15T10:00:00.000Z"],
      ["분리수거", true, "2026-11-17T10:00:00.000Z"],
    ]);
    const series = sources.get(review.items[1]!.key)!;
    expect(series).toMatchObject({ eventId: "r_2", seriesFingerprint: "2026-10-05T00:00:00.000Z", seriesId: "r" });
    expect(review.items[0]).toMatchObject({ reason: "직접 시간을 쓰는 일정처럼 보여요.", verdict: "event", writable: true });
    // Every listed occurrence, in order, for the week view.
    expect(review.items[1]!.occurrences.map((occurrence) => occurrence.id)).toEqual(["r_1", "r_2", "r_3"]);
  });

  it("marks a read-only calendar and leaves out calendars that are no longer checked", () => {
    const { review } = buildNoteReview({
      analysis: analysis([
        entry({ calendarId: BIRTHDAYS, eventId: "dad", title: "아빠 생일" }),
        entry({ calendarId: "dropped@example.test", eventId: "other", title: "Other" }),
      ]),
      calendars,
      decisions: [],
      now,
    });

    expect(review.items).toHaveLength(1);
    expect(review.items[0]).toMatchObject({ calendarName: "Birthdays", verdict: null, writable: false });
  });

  it("keeps answered entries with their answer, and names decisions by the scan's titles and times", () => {
    const { review } = buildNoteReview({
      analysis: analysis([entry({ eventId: "birthday", title: "엄마 생일" }), entry({ eventId: "gym", title: "헬스" })]),
      calendars,
      decisions: [
        {
          calendarId: HOST,
          decision: "free",
          eventId: "birthday",
          fingerprint: "2026-10-01T00:00:00.000Z",
          id: "d1",
          revision: 1,
          scope: "occurrence",
          updatedAt: now.toISOString(),
          writebackFailure: null,
          writebackState: "pending",
        },
      ],
      now,
    });

    expect(review.items.map((item) => [item.title, item.decision])).toEqual([["엄마 생일", "free"], ["헬스", null]]);
    expect(review.decisions).toEqual([
      expect.objectContaining({
        calendarName: HOST,
        decision: "free",
        end: "2026-11-17T11:00:00.000Z",
        id: "d1",
        start: "2026-11-17T10:00:00.000Z",
        title: "엄마 생일",
        writebackState: "pending",
      }),
    ]);
  });

  it("keeps the answer of an entry whose writeback moved the fingerprint past the scan", () => {
    const { review } = buildNoteReview({
      analysis: analysis([entry({ eventId: "birthday", fingerprint: "2026-10-01T00:00:00.000Z", title: "엄마 생일" })]),
      calendars,
      decisions: [
        {
          calendarId: HOST,
          decision: "free",
          eventId: "birthday",
          fingerprint: "2026-11-13T01:02:03.456Z",
          id: "d1",
          revision: 1,
          scope: "occurrence",
          updatedAt: now.toISOString(),
          writebackFailure: null,
          writebackState: "done",
        },
      ],
      now,
    });

    expect(review.items.map((item) => item.decision)).toEqual(["free"]);
  });

  it("reports a running or missing scan", () => {
    expect(buildNoteReview({ analysis: analysis([], "pending"), calendars, decisions: [], now }).review.state).toBe("pending");
    expect(buildNoteReview({ analysis: null, calendars, decisions: [], now }).review).toMatchObject({ analysisId: null, state: "unavailable" });
  });
});

describe("weekBounds", () => {
  // Friday 2026-11-13 10:00 in Seoul; the scan reads four weeks ahead.
  const now = new Date("2026-11-13T01:00:00.000Z");
  const rangeEnd = new Date("2026-12-11T01:00:00.000Z");

  it("starts on the Monday of today's week, with no week before it", () => {
    expect(weekBounds(null, "Asia/Seoul", now, rangeEnd)).toEqual({ next: "2026-11-16", previous: null, start: "2026-11-09", today: "2026-11-13" });
  });

  it("moves a requested day to its Monday and keeps it inside the scan's range ahead", () => {
    expect(weekBounds("2026-11-19", "Asia/Seoul", now, rangeEnd)).toMatchObject({ previous: "2026-11-09", start: "2026-11-16" });
    expect(weekBounds("2027-01-01", "Asia/Seoul", now, rangeEnd)).toMatchObject({ next: null, start: "2026-12-07" });
    expect(weekBounds("2026-10-01", "Asia/Seoul", now, rangeEnd)).toMatchObject({ previous: null, start: "2026-11-09" });
    expect(weekBounds("not-a-date", "Asia/Seoul", now, rangeEnd)).toMatchObject({ start: "2026-11-09" });
  });
});
