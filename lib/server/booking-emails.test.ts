import { describe, expect, it } from "vitest";
import { type BookingEmailParameters, calendarInvitation, renderBookingEmail, whenLine } from "./booking-emails";

// The booking confirmation and status emails (email-delivery: booking
// confirmation message, requester status notifications; design 9).

const meeting: BookingEmailParameters = {
  audience: "requester",
  durationMinutes: 30,
  end: "2026-11-02T01:30:00.000Z",
  hostEmail: "ada@example.test",
  hostName: "Ada Lovelace",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  location: null,
  mode: "online",
  organizerEmail: "ada@example.test",
  organizerName: "Ada Lovelace",
  requesterEmail: "grace@example.test",
  requesterName: "Grace Hopper",
  start: "2026-11-02T01:00:00.000Z",
  timezone: "Asia/Seoul",
  title: "Talk about compilers",
};
const secrets = { bookingUrl: "https://findmeatime.com/booking/0f8fad5b-d9cb-469f-a165-70867728950e" };

describe("the booking confirmation", () => {
  it("renders the English blocks, View booking and Join meeting with the zone named", () => {
    const email = renderBookingEmail("booking_confirmation", "en", meeting, secrets);

    expect(email.subject).toBe("Talk about compilers between Ada Lovelace and Grace Hopper");
    for (const text of [email.text, email.html]) {
      expect(text).toContain("Confirmed");
      expect(text).toContain("Monday, 2 November 2026, 10:00–10:30 (Asia/Seoul, GMT+9)");
      expect(text).toContain("30 minutes");
      expect(text).toContain(secrets.bookingUrl);
      expect(text).toContain("https://meet.google.com/abc-defg-hij");
    }
    expect(email.text).toContain("View booking: ");
    expect(email.text).toContain("Join meeting: ");
  });

  it("renders a Korean requester's copy in Korean", () => {
    const email = renderBookingEmail("booking_confirmation", "ko", meeting, secrets);

    expect(email.subject).toBe("Ada Lovelace 와 Grace Hopper 사이의 Talk about compilers");
    expect(email.text).toContain("확정됨");
    expect(email.text).toContain("2026년 11월 2일 월요일 10:00–10:30 (Asia/Seoul, GMT+9)");
    expect(email.text).toContain("예약 보기");
  });

  it("links the host's copy to the request in /app and carries no booking link", () => {
    const email = renderBookingEmail(
      "booking_confirmation",
      "en",
      { ...meeting, audience: "host", timezone: "America/New_York", viewUrl: "https://findmeatime.com/app?request=r1" },
      {},
    );

    expect(email.text).toContain("https://findmeatime.com/app?request=r1");
    expect(email.text).not.toContain("/booking/");
    expect(email.text).toContain("(America/New_York, GMT-5)");
  });

  it("names the place of an in-person meeting and offers no join link", () => {
    const email = renderBookingEmail("booking_confirmation", "en", { ...meeting, joinUrl: null, location: "Cafe Onion, Seongsu", mode: "in_person" }, secrets);

    expect(email.text).toContain("Cafe Onion, Seongsu");
    expect(email.text).not.toContain("Join meeting");
  });

  it("escapes text the parties wrote", () => {
    const email = renderBookingEmail("booking_confirmation", "en", { ...meeting, title: "<script>alert(1)</script>" }, secrets);
    expect(email.html).not.toContain("<script>");
  });

  it("cannot render a requester's copy without its booking link", () => {
    expect(() => renderBookingEmail("booking_confirmation", "en", meeting, {})).toThrow();
  });
});

describe("the status notifications", () => {
  it.each([
    ["status_new_version", "suggested a change"],
    ["status_declined", "declined"],
    ["status_expired", "expired"],
    ["status_pending", "still being booked"],
  ] as const)("renders %s with the booking link and no claim of a booking", (template, phrase) => {
    const email = renderBookingEmail(template, "en", meeting, secrets);

    expect(`${email.subject} ${email.text}`).toContain(phrase);
    expect(email.text).toContain(secrets.bookingUrl);
    expect(email.text).not.toMatch(/is booked\b|is confirmed/);
  });
});

describe("the calendar part", () => {
  it("is a METHOD:REQUEST invitation whose UID is the event's iCalUID", () => {
    const folded = calendarInvitation({ ...meeting, stamp: "2026-10-22T03:00:00.000Z", uid: "0f8fad5bd9cb469fa16570867728950e@google.com" });
    const ics = folded.replaceAll("\r\n ", "");

    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:0f8fad5bd9cb469fa16570867728950e@google.com");
    expect(ics).toContain("DTSTART:20261102T010000Z");
    expect(ics).toContain("DTEND:20261102T013000Z");
    expect(ics).toContain("ORGANIZER;CN=Ada Lovelace:mailto:ada@example.test");
    expect(ics).toContain("ATTENDEE;CN=Grace Hopper;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:grace@example.test");
    expect(folded.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
  });

  it("escapes text values", () => {
    const ics = calendarInvitation({ ...meeting, stamp: "2026-10-22T03:00:00.000Z", title: "Plan; budget, review", uid: "u@google.com" });
    expect(ics).toContain("SUMMARY:Plan\\; budget\\, review");
  });
});

describe("whenLine", () => {
  it("names the zone with the date's own offset", () => {
    expect(whenLine("2026-07-01T14:00:00.000Z", "2026-07-01T14:30:00.000Z", "America/New_York", "en")).toBe(
      "Wednesday, 1 July 2026, 10:00–10:30 (America/New_York, GMT-4)",
    );
  });
});
