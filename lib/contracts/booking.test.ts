import { describe, expect, it } from "vitest";
import { bookingJoinUrl, personLine } from "./booking";

describe("personLine", () => {
  it("names the person with the address", () => {
    expect(personLine("Ada Lovelace", "ada@example.test")).toBe("Ada Lovelace <ada@example.test>");
  });

  it("shows the address once when Google returns no name or the name is the address", () => {
    expect(personLine(null, "ada@example.test")).toBe("ada@example.test");
    expect(personLine("  ", "ada@example.test")).toBe("ada@example.test");
    expect(personLine("ADA@example.test", "ada@example.test")).toBe("ada@example.test");
  });

  it("shows the name alone without an address", () => {
    expect(personLine("Ada Lovelace", null)).toBe("Ada Lovelace");
  });
});

describe("bookingJoinUrl", () => {
  const meet = { joinUrl: "https://meet.google.com/abc-defg-hij" };
  it("uses the Meet Google returned for a Meet meeting", () => {
    expect(bookingJoinUrl({ linkPlan: { kind: "google_meet" }, mode: "online" }, meet)).toBe(meet.joinUrl);
  });
  it("prefers the guest's own link over a Meet the event still carries", () => {
    expect(bookingJoinUrl({ linkPlan: { kind: "requester_link", url: "https://zoom.example/j/1" }, mode: "online" }, meet)).toBe("https://zoom.example/j/1");
  });
  it("has none for an in-person meeting", () => {
    expect(bookingJoinUrl({ linkPlan: null, mode: "in_person" }, meet)).toBeNull();
  });
});
