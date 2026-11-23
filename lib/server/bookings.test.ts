import { describe, expect, it } from "vitest";
import { changePatchBody, createBookingPendingHandler } from "./bookings";
import { buildEventPayload } from "./calendar-events";
import type { ClaimedJob } from "./jobs";

// The 15-minute pending check tells the guest and no longer the host (#173):
// booking_confirmed or booking_failed follows. The guest's status_pending notice
// is pinned by tests/integration/bookings.test.ts.

function recordingTransaction(state: string) {
  const queries: string[] = [];
  const tx = (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("from app.bookings b join app.proposals p")) {
      return Promise.resolve([{ details: { mode: "online" }, end_at: new Date("2099-01-05T06:00:00Z"), request_id: "request-1", start_at: new Date("2099-01-05T05:00:00Z"), state }]);
    }
    // Every other read finds nothing, so the guest's notice stops at its parties.
    return Promise.resolve([]);
  };
  return { queries, tx: tx as never };
}

const job = { payload: { bookingId: "booking-1" } } as unknown as ClaimedJob;
const deps = () => ({ origin: "http://localhost:3000", tokenKey: { id: "k", key: Buffer.alloc(32) }, tokenKeys: [] }) as never;

describe("the booking pending check", () => {
  it("queues no host notice while the booking is still dispatching", async () => {
    const { queries, tx } = recordingTransaction("dispatching");
    await expect(createBookingPendingHandler(deps)(tx, job)).resolves.toEqual({ sent: true });
    expect(queries.some((query) => query.includes("app.imessage_bindings"))).toBe(false);
    expect(queries.some((query) => query.includes("app.jobs"))).toBe(false);
  });

  it("sends nothing once the booking is no longer dispatching", async () => {
    const { queries, tx } = recordingTransaction("confirmed");
    await expect(createBookingPendingHandler(deps)(tx, job)).resolves.toEqual({ sent: false });
    expect(queries).toHaveLength(1);
  });
});

// A change patches the booked event (post-booking-changes design 5). The bodies
// come from the same insert payload a booking freezes.
describe("the change patch body", () => {
  const source = {
    bookingId: "11111111-1111-4111-8111-111111111111",
    end: "2099-01-05T06:00:00Z",
    hostTimezone: "Asia/Seoul",
    purpose: "Coffee",
    requester: { email: "guest@example.com", name: "Guest" },
    start: "2099-01-05T05:00:00Z",
  };
  const meet = buildEventPayload({ ...source, linkPlan: { kind: "google_meet" }, location: null, mode: "online" } as never);
  const inPerson = buildEventPayload({ ...source, linkPlan: null, location: "Cafe Seoul", mode: "in_person" } as never);
  const guestLink = buildEventPayload({ ...source, linkPlan: { kind: "requester_link", url: "https://zoom.example/j/1" }, location: null, mode: "online" } as never);

  it("removes the Meet when a booked online meeting changes to in person", () => {
    const body = changePatchBody(inPerson, true);
    expect(body).toMatchObject({ conferenceData: null, location: "Cafe Seoul" });
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("attendees");
  });

  it("removes the Meet when the change uses the guest's own link", () => {
    expect(changePatchBody(guestLink, true)).toMatchObject({ conferenceData: null, location: "https://zoom.example/j/1" });
  });

  it("keeps an existing Meet and clears an old place when the change stays on Meet", () => {
    const body = changePatchBody(meet, true);
    expect(body).not.toHaveProperty("conferenceData");
    expect(body.location).toBeNull();
  });

  it("creates a Meet when the event has none", () => {
    expect(changePatchBody(meet, false)).toMatchObject({ conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } }, location: null });
  });
});
