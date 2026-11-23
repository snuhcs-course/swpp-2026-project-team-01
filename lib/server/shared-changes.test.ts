import { describe, expect, it } from "vitest";
import { replacementChanges } from "./shared-changes";

// A suggestion the assistant drafts over a pending one keeps the pending
// changes it does not change (host-assistant-story-fixes D1, #275).
describe("replacementChanges", () => {
  const wednesday = "2026-11-25T15:00:00+09:00";

  it("keeps the pending time when the new suggestion changes only the mode and place", () => {
    expect(replacementChanges({ start: wednesday }, { location: "강남역", mode: "in_person" })).toEqual({
      location: "강남역",
      mode: "in_person",
      start: wednesday,
    });
  });

  it("lets the new suggestion override what it changes", () => {
    expect(replacementChanges({ durationMinutes: 45, start: wednesday }, { start: "2026-11-26T11:00:00+09:00" })).toEqual({
      durationMinutes: 45,
      start: "2026-11-26T11:00:00+09:00",
    });
  });

  it("drops the pending place when the meeting moves online, and the pending link when it moves in person", () => {
    expect(replacementChanges({ location: "강남역", mode: "in_person", start: wednesday }, { mode: "online" })).toEqual({
      mode: "online",
      start: wednesday,
    });
    expect(
      replacementChanges({ linkPlan: { kind: "requester_link", url: "https://meet.example/abc" }, mode: "online" }, { location: "강남역", mode: "in_person" }),
    ).toEqual({ location: "강남역", mode: "in_person" });
  });

  it("treats a new place without a mode as in person and a new link without a mode as online", () => {
    const link = { kind: "requester_link", url: "https://meet.example/abc" } as const;
    expect(replacementChanges({ linkPlan: link, mode: "online", start: wednesday }, { location: "강남역" })).toEqual({
      location: "강남역",
      mode: "in_person",
      start: wednesday,
    });
    expect(replacementChanges({ location: "강남역", mode: "in_person", start: wednesday }, { linkPlan: link })).toEqual({
      linkPlan: link,
      mode: "online",
      start: wednesday,
    });
  });

  it("keeps a pending mode that a new place or link agrees with", () => {
    expect(replacementChanges({ location: "역삼역", mode: "in_person" }, { location: "강남역" })).toEqual({
      location: "강남역",
      mode: "in_person",
    });
  });

  it("never stores a mode beside the other mode's place or link", () => {
    const link = { kind: "requester_link", url: "https://meet.example/abc" } as const;
    // Both a place and a link without a mode: the pending mode decides which stays.
    expect(replacementChanges({ mode: "online", start: wednesday }, { linkPlan: link, location: "강남역" })).toEqual({
      linkPlan: link,
      mode: "online",
      start: wednesday,
    });
    expect(replacementChanges({ mode: "in_person" }, { linkPlan: link, location: "강남역" })).toEqual({
      location: "강남역",
      mode: "in_person",
    });
    // A new mode wins over a place or link that contradicts it.
    expect(replacementChanges({ start: wednesday }, { location: "강남역", mode: "online" })).toEqual({
      mode: "online",
      start: wednesday,
    });
    // A pending place and a new link: the link moves the meeting online.
    expect(replacementChanges({ location: "강남역" }, { linkPlan: link })).toEqual({ linkPlan: link, mode: "online" });
  });

  it("keeps a pending place and link as they are while no mode is known", () => {
    const link = { kind: "requester_link", url: "https://meet.example/abc" } as const;
    expect(replacementChanges({ start: wednesday }, { linkPlan: link, location: "강남역" })).toEqual({
      linkPlan: link,
      location: "강남역",
      start: wednesday,
    });
  });

  it("stores the new suggestion as it is when nothing is pending", () => {
    expect(replacementChanges(null, { durationMinutes: 60 })).toEqual({ durationMinutes: 60 });
  });
});
