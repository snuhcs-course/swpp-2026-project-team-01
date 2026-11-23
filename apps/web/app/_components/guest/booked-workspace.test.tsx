import type { BookingReceipt } from "@lib/contracts/booking";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookedWorkspace } from "./booked-workspace";

// A booked meeting's page keeps the conversation (#329): the receipt in the
// thread with Thyme's line on cancelling or changing, and an open composer.

const host = { displayName: "Barbara Liskov", handle: "barbara" };
const receipt: BookingReceipt = {
  calendarUrl: null,
  durationMinutes: 30,
  end: "2026-11-25T01:30:00Z",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  linkPlan: { kind: "google_meet" },
  location: null,
  mode: "online",
  organizer: { email: "barbara@example.com", name: "Barbara Liskov" },
  requester: { email: "ada@example.com", name: "Ada Lovelace" },
  start: "2026-11-25T01:00:00Z",
  title: "Barbara Liskov and Ada Lovelace",
};

describe("BookedWorkspace", () => {
  it("keeps the conversation open under the confirmed receipt", () => {
    const html = renderToStaticMarkup(<BookedWorkspace bookingId="booking" host={host} receipt={receipt} timezone="Asia/Seoul" />);

    expect(html).toContain("Your meeting with Barbara Liskov is booked. If you need to move it, change where it happens or cancel it, tell me here.");
    expect(html).toContain('data-guest-card="booked"');
    expect(html).toContain("Confirmed");
    expect(html).toContain("Write to Thyme");
    expect(html).not.toContain("Finish the step above");
    expect(html).not.toContain("Withdraw request");
  });
});
