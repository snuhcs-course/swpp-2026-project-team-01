import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { markLanes, WeekCalendar } from "./week-calendar";

const base = {
  focusDay: "2026-12-01",
  itemsLabel: "Your events",
  label: "Calendar",
  marksLabel: "Candidate times",
  timeZone: "Asia/Seoul",
};

describe("WeekCalendar", () => {
  it("draws a week with events and marked times as named buttons", () => {
    const html = renderToStaticMarkup(
      <WeekCalendar
        {...base}
        items={[{ end: "2026-12-01T02:00:00.000Z", id: "e1", srLabel: "Google Calendar event: Lab meeting", start: "2026-12-01T01:00:00.000Z", title: "Lab meeting", tone: "google" }]}
        marks={[
          { end: "2026-12-01T01:30:00.000Z", id: "m1", onSelect: () => {}, srLabel: "Choose this time: Tuesday 1 Dec, 10:00–10:30", start: "2026-12-01T01:00:00.000Z", tone: "option" },
          { end: "2026-12-09T01:30:00.000Z", id: "m2", srLabel: "Later", start: "2026-12-09T01:00:00.000Z", tone: "option" },
        ]}
      />,
    );
    expect(html).toContain("30 Nov – 6 Dec 2026");
    expect(html).toContain('aria-label="Choose this time: Tuesday 1 Dec, 10:00–10:30"');
    expect(html).toContain("Google Calendar event: Lab meeting");
    expect(html).toContain('aria-label="Candidate times"');
    // The mark covers the event, so it is inset to keep the event visible.
    expect(html).toContain("cw-mark cw-option cw-inset");
    // The time in another week is counted, not drawn.
    expect(html).not.toContain("Later");
    expect(html).toContain("1 more time on other weeks");
    expect(html).toContain('aria-label="Next week"');
  });

  it("shows one day with a day switcher when narrow", () => {
    const html = renderToStaticMarkup(
      <WeekCalendar {...base} items={[]} marks={[{ end: "2026-12-02T01:30:00.000Z", id: "m1", srLabel: "A time", start: "2026-12-02T01:00:00.000Z", tone: "option" }]} narrow />,
    );
    expect(html).toContain("Tuesday 1 Dec");
    expect(html).toContain('aria-label="Wednesday 2 Dec, 1 time"');
    expect(html).toContain('aria-label="Next day"');
    expect(html).toContain("1 more time on other days");
  });
});

describe("markLanes", () => {
  it("puts overlapping times side by side and leaves others full width", () => {
    const mark = (id: string, start: string, end: string) => ({ end, id, srLabel: id, start, tone: "option" as const });
    const lanes = markLanes(
      [
        mark("a", "2026-12-01T01:00:00.000Z", "2026-12-01T01:30:00.000Z"),
        mark("b", "2026-12-01T01:00:00.000Z", "2026-12-01T01:30:00.000Z"),
        mark("c", "2026-12-01T01:15:00.000Z", "2026-12-01T01:45:00.000Z"),
        mark("d", "2026-12-01T03:00:00.000Z", "2026-12-01T03:30:00.000Z"),
      ],
      "Asia/Seoul",
    );
    expect(Object.fromEntries(lanes)).toEqual({ a: { count: 3, lane: 0 }, b: { count: 3, lane: 1 }, c: { count: 3, lane: 2 }, d: { count: 1, lane: 0 } });
  });
});
