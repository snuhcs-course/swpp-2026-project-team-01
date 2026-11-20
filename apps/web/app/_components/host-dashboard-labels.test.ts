import type { DashboardEvent } from "@lib/server/host-dashboard";
import { describe, expect, it } from "vitest";
import { detailNote, detailSource, sentState, sourceLabel } from "./host-dashboard-labels";

function event(overrides: Partial<DashboardEvent>): DashboardEvent {
  return { allDay: false, end: "2026-11-20T02:00:00.000Z", id: "x", location: null, source: "google", start: "2026-11-20T01:00:00.000Z", title: "Meeting", ...overrides };
}

describe("host dashboard detail labels", () => {
  it("labels Google Calendar events as Google", () => {
    const google = event({ source: "google" });
    expect(detailSource(google)).toBe("Google Calendar");
    expect(detailNote(google)).toContain("private Google Calendar");
  });

  it("labels Find Me a Time meetings as Thyme meetings", () => {
    const thyme = event({ source: "thyme" });
    expect(detailSource(thyme)).toBe("Thyme meeting");
    expect(detailNote(thyme)).toContain("Booked by Thyme");
  });

  it("labels sent requests with their state, never as Google Calendar", () => {
    const awaiting = event({ source: "sent", state: "awaiting_host_approval" });
    expect(sourceLabel(awaiting)).toBe("Sent request");
    expect(detailSource(awaiting)).toBe("Sent request · Awaiting approval");
    expect(detailNote(awaiting)).toContain("request you sent to another host");
    expect(detailNote(awaiting)).toContain("not booked yet");
    expect(detailNote(awaiting)).not.toContain("Google Calendar");

    const booked = event({ source: "sent", state: "booked" });
    expect(sentState(booked)).toBe("Booked");
    expect(detailSource(booked)).toBe("Sent request · Booked");
    expect(detailNote(booked)).toContain("The meeting is booked.");
  });
});
