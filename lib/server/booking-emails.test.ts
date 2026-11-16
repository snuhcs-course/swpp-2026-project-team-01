import { describe, expect, it } from "vitest";
import { type BookingEmailParameters, calendarInvitation, meetingChanges, renderBookingEmail, whenLine } from "./booking-emails";

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
  it("from the product inbox carry no link and ask for a reply (U15)", () => {
    const email = renderBookingEmail("status_new_version", "en", { ...meeting, version: 2 }, {});
    expect(email.text).not.toContain("/booking/");
    expect(email.text).toContain("Reply to agree, or to ask for something else.");
    expect(email.text).toContain("Reply to this email to continue with Thyme.");
  });

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

describe("the cancellation notices (post-booking-changes)", () => {
  it("tells the requester the host cancelled, with the time in their zone", () => {
    const email = renderBookingEmail("status_cancelled", "en", { ...meeting, bookingId: "b1" }, secrets);
    expect(email.subject).toBe("Your meeting with Ada Lovelace was cancelled");
    expect(email.text).toContain("Monday, 2 November 2026, 10:00–10:30 (Asia/Seoul, GMT+9)");
    expect(email.text).toContain(secrets.bookingUrl);

    const inbox = renderBookingEmail("status_cancelled", "ko", { ...meeting, bookingId: "b1" }, {});
    expect(inbox.subject).toBe("Ada Lovelace님과의 미팅이 취소되었습니다");
    expect(inbox.text).toContain("답장");
    expect(inbox.text).not.toContain("/booking/");
  });

  it("tells the host the requester cancelled and links the request in /app", () => {
    const viewUrl = "https://findmeatime.com/app?request=7d5f4a8e-6b1c-4f7e-9a2d-3c8b1e0f5a6d";
    const email = renderBookingEmail("booking_cancelled", "en", { ...meeting, audience: "host", viewUrl }, {});
    expect(email.subject).toBe("Grace Hopper cancelled: Talk about compilers");
    expect(email.text).toContain("Grace Hopper cancelled your booked meeting");
    expect(email.text).toContain(`View request: ${viewUrl}`);
    expect(email.html).toContain(viewUrl);
    expect(() => renderBookingEmail("booking_cancelled", "en", { ...meeting, audience: "host" }, {})).toThrow();
  });
});

describe("changes after booking (post-booking-changes)", () => {
  it("says a declined or expired change leaves the meeting as it was", () => {
    const declined = renderBookingEmail("status_change_dropped", "en", { ...meeting, bookingId: "b1", reason: "declined" }, secrets);
    expect(declined.subject).toBe("Your meeting with Ada Lovelace stays as booked");
    expect(declined.text).toContain("kept your meeting as it was");
    expect(declined.text).toContain("10:00–10:30");
    expect(renderBookingEmail("status_change_dropped", "ko", { ...meeting, reason: "expired" }, secrets).text).toContain("기한 안에");
  });

  it("confirms a changed meeting as updated", () => {
    const email = renderBookingEmail("booking_confirmation", "en", { ...meeting, changed: true }, secrets);
    expect(email.text).toContain("Your meeting was changed, and the calendar event is updated.");
  });
});

describe("the new-version notice says what the host changed (#198)", () => {
  const inPerson: BookingEmailParameters = { ...meeting, joinUrl: null, location: "Seoul Station", mode: "in_person", version: 2 };
  const terms = (parameters: BookingEmailParameters) => ({
    end: parameters.end,
    location: parameters.location,
    mode: parameters.mode,
    start: parameters.start,
  });

  it("lists only the place when only the place changed", () => {
    const email = renderBookingEmail("status_new_version", "en", { ...inPerson, location: "Cafe Onion, Seongsu", previous: terms(inPerson) }, secrets);

    for (const text of [email.text, email.html]) {
      expect(text).toContain("What changed");
      expect(text).toContain("Place: Cafe Onion, Seongsu (was: Seoul Station)");
      expect(text).not.toContain("Time:");
      expect(text).not.toContain("Length:");
      expect(text).not.toContain("Meeting type:");
    }
    expect(email.text).toContain("Ada Lovelace sent back changed meeting details.\n");
  });

  it("lists only the time when only the time changed", () => {
    const moved = { ...inPerson, end: "2026-11-03T06:30:00.000Z", previous: terms(inPerson), start: "2026-11-03T06:00:00.000Z" };
    const email = renderBookingEmail("status_new_version", "en", moved, secrets);

    expect(email.text).toContain(
      "Time: Tuesday, 3 November 2026, 15:00–15:30 (Asia/Seoul, GMT+9) (was: Monday, 2 November 2026, 10:00–10:30 (Asia/Seoul, GMT+9))",
    );
    expect(email.text).not.toContain("Place:");
    expect(email.text).not.toContain("Length:");
    expect(email.text).not.toContain("Meeting type:");
  });

  it("names a new meeting type, place and length together, in Korean", () => {
    const online = { ...meeting, version: 2 };
    const email = renderBookingEmail(
      "status_new_version",
      "ko",
      { ...inPerson, end: "2026-11-02T02:00:00.000Z", previous: terms(online) },
      secrets,
    );

    expect(email.text).toContain("바뀐 내용:");
    expect(email.text).toContain("소요 시간: 60분 (이전: 30분)");
    expect(email.text).toContain("미팅 방식: 대면 (이전: 온라인)");
    expect(email.text).toContain("장소: Seoul Station (이전: 없음)");
    expect(email.text).not.toContain("시간: 2026");
  });

  it("escapes a changed place in the HTML", () => {
    const email = renderBookingEmail("status_new_version", "en", { ...inPerson, location: "<b>Lab</b>", previous: terms(inPerson) }, secrets);
    expect(email.html).not.toContain("<b>Lab</b>");
  });

  it("keeps the new time in the sentence when it does not know the earlier version", () => {
    const email = renderBookingEmail("status_new_version", "en", inPerson, secrets);

    expect(email.text).toContain("sent back changed meeting details: Monday, 2 November 2026, 10:00–10:30");
    expect(email.text).not.toContain("What changed");
  });

  it("finds no change between equal versions", () => {
    expect(meetingChanges(terms(inPerson), { ...terms(inPerson), location: " Seoul Station " })).toEqual([]);
    expect(meetingChanges(terms(meeting), { ...terms(meeting), end: "2026-11-02T01:45:00.000Z" })).toEqual(["duration"]);
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
