import { describe, expect, it } from "vitest";
import {
  type BusyInterval,
  type Endpoint,
  evaluateFeasibility,
  type FeasibilityInput,
  type HostRules,
  requesterProjection,
  type RouteOutcome,
} from "./feasibility";

// Routing evaluation (issue #186; recorded in documentation 13, "Routing time
// and the offered slots"): the same in-person search twice, with the same
// calendar, request and settings, changing only the route duration. The slot a
// shorter trip leaves room for must be among the times the guest is shown, and
// a longer trip must leave it out. The guest-visible list is
// requesterProjection, which the evaluation job stores and the booking page and
// assistant read; tests/integration/routing-slots.test.ts repeats this through
// the real evaluation job and fake Routes.

const NOW = new Date("2026-10-30T00:00:00Z");
const kst = (clock: string) => new Date(`2026-11-02T${clock}:00+09:00`);

const HOST: HostRules = {
  bufferAfterMinutes: 10,
  bufferBeforeMinutes: 10,
  meetingMode: "either",
  timezone: "Asia/Seoul",
  travelBufferMinutes: 15,
  travelMode: "transit",
  weeklyLimit: null,
  weeklyLimitCounts: "bookings",
  weeklyWindows: (["monday", "tuesday", "wednesday", "thursday", "friday"] as const).map((weekday) => ({ end: "17:00", start: "10:00", weekday })),
};

const hashed = (text: string) => `h:${Buffer.from(text).toString("hex")}`;
const OFFICE = { key: hashed("Gangnam office"), kind: "place", text: "Gangnam office" } satisfies Endpoint;
const CAFE = { key: hashed("Cafe Onion, Seongsu"), text: "Cafe Onion, Seongsu" };

// The host's calendar: a commitment at the office until 11:00 on Monday 2 Nov.
const HOST_BUSY: BusyInterval[] = [{ allDay: false, end: kst("11:00").getTime(), endpoint: OFFICE, meeting: false, start: kst("10:00").getTime() }];

// The guest asks for 11:00 to 12:30 in person at the cafe. With 10 minutes of
// buffer before and 15 of travel buffer, the earliest start is 11:00 plus the
// trip plus 25 minutes.
function search(tripMinutes: number): FeasibilityInput {
  const trip = (query: { origin: string; destination: string }): RouteOutcome =>
    query.origin === OFFICE.text && query.destination === CAFE.text ? { durationSeconds: tripMinutes * 60, outcome: "route" } : { outcome: "failed" };
  return {
    estimate: trip,
    host: HOST,
    hostBusy: HOST_BUSY,
    now: NOW,
    request: {
      durationMinutes: 30,
      linkPlan: null,
      location: CAFE,
      mode: "in_person",
      timezone: "Asia/Seoul",
      travelMode: "transit",
      windows: [{ end: kst("12:30"), start: kst("11:00") }],
    },
    requesterBusy: null,
  };
}

function guestVisibleStarts(tripMinutes: number) {
  const result = evaluateFeasibility(search(tripMinutes));
  const shown = requesterProjection(result.candidates, { displayTimezone: "Asia/Seoul", id: "routing", state: "completed" });
  return shown.candidates.map((candidate) => candidate.start).sort();
}

describe("routing time and the slots offered to guests", () => {
  const expected = kst("11:45").toISOString();

  it("offers 11:45 with a 20-minute trip and leaves it out with a 35-minute trip", () => {
    const shorter = guestVisibleStarts(20);
    const longer = guestVisibleStarts(35);

    // 11:00 + 20 + 25 = 11:45: the expected slot is the first one shown.
    expect(shorter).toEqual(["11:45", "12:00"].map((clock) => kst(clock).toISOString()));
    // 11:00 + 35 + 25 = 12:00: 11:45 is gone and only 12:00 remains.
    expect(longer).toEqual([kst("12:00").toISOString()]);
    expect(shorter).toContain(expected);
    expect(longer).not.toContain(expected);
  });

  it("changes nothing but the route between the two searches", () => {
    const { estimate: _short, ...shorter } = search(20);
    const { estimate: _long, ...longer } = search(35);

    expect(longer).toEqual(shorter);
  });
});
