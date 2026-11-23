import { describe, expect, it } from "vitest";
import { createBookingPendingHandler } from "./bookings";
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
