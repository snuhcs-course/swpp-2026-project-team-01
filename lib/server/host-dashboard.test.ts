import { describe, expect, it } from "vitest";
import { type BookingRow, bookedEvent } from "./host-dashboard";

function row(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    calendar_id: "primary",
    contact_confirmed_email: "grace@example.com",
    contact_email: "grace@example.com",
    details: { linkPlan: { kind: "google_meet" }, location: null, mode: "online" },
    end_at: new Date("2026-11-20T01:30:00.000Z"),
    event_id: "abc12",
    evidence: { iCalUID: "uid@google.com", joinUrl: "https://meet.google.com/abc-defg-hij" },
    id: "booking-1",
    payload: { summary: "Project kickoff" },
    purpose: "Project kickoff",
    request_id: "request-1",
    requester_name: "Grace Hopper",
    start_at: new Date("2026-11-20T01:00:00.000Z"),
    ...overrides,
  };
}

describe("host dashboard booked meetings", () => {
  it("carries an online meeting's length, mode, Meet link, guest and request", () => {
    const event = bookedEvent(row());
    expect(event).toMatchObject({ id: "thyme:booking-1", location: null, source: "thyme", title: "Project kickoff" });
    expect(event.meeting).toEqual({
      durationMinutes: 30,
      guest: { email: "grace@example.com", emailConfirmed: true, name: "Grace Hopper" },
      joinUrl: "https://meet.google.com/abc-defg-hij",
      mode: "online",
      purpose: "Project kickoff",
      requestId: "request-1",
    });
  });

  it("uses the requester's own link when Google returned none", () => {
    const event = bookedEvent(row({ details: { linkPlan: { kind: "requester_link", url: "https://zoom.us/j/1" }, mode: "online" }, evidence: { iCalUID: null } }));
    expect(event.meeting?.joinUrl).toBe("https://zoom.us/j/1");
  });

  it("gives an in-person meeting its place and no join link", () => {
    const event = bookedEvent(row({ details: { linkPlan: null, location: "Building 301", mode: "in_person" }, evidence: { joinUrl: "https://meet.google.com/x" }, payload: { summary: "Coffee" } }));
    expect(event.location).toBe("Building 301");
    expect(event.meeting).toMatchObject({ joinUrl: null, mode: "in_person" });
  });

  it("marks an unconfirmed guest address and falls back to a titled meeting", () => {
    const event = bookedEvent(row({ contact_confirmed_email: null, payload: null, purpose: null }));
    expect(event.title).toBe("Meeting booked by Thyme");
    expect(event.meeting?.guest.emailConfirmed).toBe(false);
    expect(event.meeting?.purpose).toBeNull();
  });
});
