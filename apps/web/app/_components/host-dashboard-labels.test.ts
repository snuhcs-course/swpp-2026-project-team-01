import type { DashboardEvent } from "@lib/server/host-dashboard";
import { describe, expect, it } from "vitest";
import { blockLabel, detailNote, detailSource, meetingFacts, meetingRequestPath, receivedFacts, sentState, sourceLabel } from "./host-dashboard-labels";

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

  const meeting = {
    durationMinutes: 30,
    guest: { email: "grace@example.com", emailConfirmed: true, name: "Grace Hopper" },
    joinUrl: "https://meet.google.com/abc-defg-hij",
    mode: "online" as const,
    purpose: "Project kickoff",
    requestId: "request-1",
  };

  it("lists a booked online meeting's details the way the host approved them", () => {
    const booked = event({ meeting, source: "thyme", title: "Project kickoff" });
    expect(meetingFacts(booked, "10:00 AM – 10:30 AM")).toEqual([
      { label: "When", value: "10:00 AM – 10:30 AM" },
      { label: "Length", value: "30 minutes" },
      { label: "Mode", value: "Online" },
      { href: "https://meet.google.com/abc-defg-hij", label: "Meeting link", value: "https://meet.google.com/abc-defg-hij" },
      { label: "With", value: "Grace Hopper <grace@example.com>" },
    ]);
    expect(meetingRequestPath(booked)).toBe("/app?request=request-1");
    expect(blockLabel(booked)).toBe("With Grace Hopper");
  });

  it("shows an in-person meeting's place, an unconfirmed address and a purpose that differs from the title", () => {
    const booked = event({
      location: "Building 301",
      meeting: { ...meeting, guest: { ...meeting.guest, emailConfirmed: false }, joinUrl: null, mode: "in_person", purpose: "Thesis review" },
      source: "thyme",
      title: "Meeting with Grace Hopper",
    });
    const facts = meetingFacts(booked, "All day");
    expect(facts).toContainEqual({ label: "Place", value: "Building 301" });
    expect(facts).toContainEqual({ label: "With", value: "Grace Hopper <grace@example.com> (address not confirmed)" });
    expect(facts).toContainEqual({ label: "Purpose", value: "Thesis review" });
    expect(facts.some((fact) => fact.label === "Meeting link")).toBe(false);
  });

  it("gives other events no meeting details or request link", () => {
    const google = event({ source: "google", title: "Lunch" });
    expect(meetingFacts(google, "noon")).toEqual([]);
    expect(meetingRequestPath(google)).toBeNull();
    expect(blockLabel(google)).toBe("Lunch");
  });

  it("labels a received request as awaiting the host's decision, not booked, with a way to open it", () => {
    const received = event({
      received: { purpose: "Thesis feedback", requestId: "request-9", requesterName: "Ada Lovelace" },
      source: "received",
      state: "awaiting_host_approval",
      title: "Request from Ada Lovelace",
    });
    expect(sourceLabel(received)).toBe("Request awaiting your decision");
    expect(detailSource(received)).toBe("Received request · Needs your decision");
    expect(detailNote(received)).toContain("not booked until you approve it");
    expect(detailNote(received)).not.toContain("Google Calendar");
    expect(blockLabel(received)).toBe("From Ada Lovelace");
    expect(meetingRequestPath(received)).toBe("/app?request=request-9");
    expect(receivedFacts(received, "1:30 PM – 2:00 PM")).toEqual([
      { label: "Proposed time", value: "1:30 PM – 2:00 PM" },
      { label: "From", value: "Ada Lovelace" },
      { label: "Purpose", value: "Thesis feedback" },
    ]);
    expect(meetingFacts(received, "x")).toEqual([]);
    expect(receivedFacts(event({ source: "google" }), "x")).toEqual([]);
  });
});
