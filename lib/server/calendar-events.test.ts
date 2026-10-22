import { describe, expect, it } from "vitest";
import { buildEventPayload, eventIdFor, eventTitle } from "./calendar-events";

const source = {
  bookingId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  end: "2026-11-02T01:30:00.000Z",
  hostTimezone: "Asia/Seoul",
  linkPlan: null,
  location: "Cafe Onion, Seongsu",
  mode: "in_person" as const,
  purpose: "Talk about compilers",
  requester: { email: "grace@example.test", name: "Grace Hopper" },
  start: "2026-11-02T01:00:00.000Z",
};

describe("calendar events", () => {
  it("derives a base32hex event ID from the booking ID", () => {
    expect(eventIdFor(source.bookingId)).toBe("0f8fad5bd9cb469fa16570867728950e");
    expect(eventIdFor(source.bookingId)).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(() => eventIdFor("not-a-uuid")).toThrow();
  });

  it("invites only the requester and keeps the booking link out", () => {
    const payload = buildEventPayload(source);

    expect(payload.attendees).toEqual([{ displayName: "Grace Hopper", email: "grace@example.test" }]);
    expect(payload.location).toBe("Cafe Onion, Seongsu");
    expect(payload.guestsCanModify).toBe(false);
    expect(payload.reminders).toEqual({ useDefault: true });
    expect(JSON.stringify(payload)).not.toContain("/booking/");
    expect(payload).not.toHaveProperty("conferenceData");
  });

  it("asks for a Meet conference for a Google Meet plan", () => {
    const payload = buildEventPayload({ ...source, linkPlan: { kind: "google_meet" }, location: null, mode: "online" });

    expect(payload.conferenceData).toEqual({
      createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" }, requestId: source.bookingId },
    });
    expect(payload).not.toHaveProperty("location");
  });

  it("uses the requester's own link as the place of an online meeting", () => {
    const payload = buildEventPayload({
      ...source,
      linkPlan: { kind: "requester_link", url: "https://zoom.us/j/123" },
      location: null,
      mode: "online",
    });

    expect(payload.location).toBe("https://zoom.us/j/123");
    expect(String(payload.description)).toContain("Join: https://zoom.us/j/123");
  });

  it("titles the event from the purpose, or after the requester", () => {
    expect(eventTitle("  Coffee  ", "Grace")).toBe("Coffee");
    expect(eventTitle(null, "Grace")).toBe("Meeting with Grace");
  });
});
