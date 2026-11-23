import { describe, expect, it } from "vitest";
import { type BookingRow, bookedEvent, receivedEvent } from "./host-dashboard";

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

describe("host dashboard received requests", () => {
  it("draws a request awaiting a decision at its proposed time, never as a booking", () => {
    const event = receivedEvent({
      end_at: new Date("2026-11-25T06:00:00.000Z"),
      id: "request-9",
      purpose: "  Thesis feedback ",
      requester_name: "Ada Lovelace",
      start_at: new Date("2026-11-25T05:30:00.000Z"),
      state: "awaiting_host_approval",
    });
    expect(event).toEqual({
      allDay: false,
      end: "2026-11-25T06:00:00.000Z",
      id: "received:request-9",
      location: null,
      received: { purpose: "Thesis feedback", requestId: "request-9", requesterName: "Ada Lovelace" },
      source: "received",
      start: "2026-11-25T05:30:00.000Z",
      state: "awaiting_host_approval",
      title: "Request from Ada Lovelace",
    });
    expect(event.meeting).toBeUndefined();
  });

  it("names a requester without a name as Guest and drops an empty purpose", () => {
    const event = receivedEvent({ end_at: new Date(1), id: "r", purpose: " ", requester_name: null, start_at: new Date(0), state: "negotiating" });
    expect(event.title).toBe("Request from Guest");
    expect(event.received).toEqual({ purpose: null, requestId: "r", requesterName: "Guest" });
  });
});
