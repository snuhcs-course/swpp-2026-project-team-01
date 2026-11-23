import type { HostRequestView } from "@lib/contracts/host-request";
import type { DashboardEvent } from "@lib/server/host-dashboard";
import { describe, expect, it } from "vitest";
import { decisionItems, decisionMarks, showsDecisionCalendar } from "./host-decision-calendar";

const view = (overrides: Partial<HostRequestView> = {}) =>
  ({
    details: { durationMinutes: 30 },
    evaluation: null,
    hostTimezone: "Asia/Seoul",
    proposal: { durationMinutes: 30, end: "2026-12-01T01:30:00.000Z", start: "2026-12-01T01:00:00.000Z" },
    requestId: "r1",
    sample: false,
    state: "awaiting_host_approval",
    suggestion: null,
    ...overrides,
  }) as unknown as HostRequestView;

describe("the host's calendar beside a decision", () => {
  it("is shown while a time is on screen, never for a sample or a closed request", () => {
    expect(showsDecisionCalendar(view(), false)).toBe(true);
    expect(showsDecisionCalendar(view({ sample: true }), false)).toBe(false);
    expect(showsDecisionCalendar(view({ state: "declined" }), false)).toBe(false);
    expect(showsDecisionCalendar(view({ proposal: null }), false)).toBe(false);
    expect(showsDecisionCalendar(view({ proposal: null }), true)).toBe(true);
  });

  it("marks the proposal, a suggestion, the draft and open times, without repeats", () => {
    const marks = decisionMarks(
      view({
        evaluation: {
          candidates: [
            { end: "2026-12-01T01:30:00.000Z", id: "c0", start: "2026-12-01T01:00:00.000Z", status: "offered" },
            { end: "2026-12-02T01:30:00.000Z", id: "c1", start: "2026-12-02T01:00:00.000Z", status: "offered" },
            { end: "2026-12-03T01:30:00.000Z", id: "c2", start: "2026-12-03T01:00:00.000Z", status: "host_unresolved" },
          ],
        } as never,
        suggestion: { changes: { durationMinutes: 60, start: "2026-12-01T05:00:00.000Z" }, state: "pending" } as never,
      }),
      "2026-12-04T02:00:00.000Z",
      () => {},
    );
    expect(marks.map((mark) => [mark.id, mark.tag, mark.end])).toEqual([
      ["proposal", "Proposed", "2026-12-01T01:30:00.000Z"],
      ["suggestion", "Your suggestion", "2026-12-01T06:00:00.000Z"],
      ["draft", "New time", "2026-12-04T02:30:00.000Z"],
      ["candidate-c1", undefined, "2026-12-02T01:30:00.000Z"],
    ]);
    expect(marks[0]!.srLabel).toBe("Proposed time: Tuesday 1 Dec, 10:00–10:30");
    expect(marks[3]!.srLabel).toBe("Suggest this open time: Wednesday 2 Dec, 10:00–10:30");
    expect(marks[3]!.onSelect).toBeTypeOf("function");
  });

  it("draws Dashboard events and leaves out this request's own block", () => {
    const events = [
      { allDay: false, end: "b", id: "g", location: null, source: "google", start: "a", title: "Lab" },
      { allDay: false, end: "b", id: "x", location: null, received: { requestId: "r1" }, source: "received", start: "a", title: "From Ada" },
    ] as unknown as DashboardEvent[];
    expect(decisionItems(events, "r1").map((item) => [item.id, item.tone, item.srLabel])).toEqual([["g", "google", "Google Calendar event: Lab"]]);
  });
});
