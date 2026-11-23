import { describe, expect, it } from "vitest";
import { agreementNoticeText, type AgreementSummary, readAgreementSummary } from "./agreement-notice";
import type { Queryable } from "./database";
import { guestNoticeKey } from "./imessage-notices";

// The notice a guest gets in their linked chat when they agree to a proposal
// (guest-email-and-agree-notices design 4, #179): what they sent, from the
// agreed version's records, in English, without the booking link.

const summary: AgreementSummary = {
  changesBooking: false,
  durationMinutes: 30,
  end: new Date("2026-11-30T01:30:00Z"),
  hostName: "Ada Lovelace",
  location: null,
  mode: "online",
  purpose: "Talk about compilers",
  requesterName: "Grace Hopper",
  start: new Date("2026-11-30T01:00:00Z"),
  timezone: "Asia/Seoul",
  version: 2,
};

describe("the agreement notice text", () => {
  it("lists the people, purpose, time with the zone, length and place, and says it is not booked", () => {
    expect(agreementNoticeText(summary)).toBe(
      [
        "You sent this to Ada Lovelace:",
        "- People: Ada Lovelace and Grace Hopper",
        "- Purpose: Talk about compilers",
        "- When: Mon, Nov 30, 2026, 10:00 AM–10:30 AM (Asia/Seoul)",
        "- Length: 30 minutes",
        "- Where: Online",
        "It is waiting for Ada Lovelace's approval and is not booked yet.",
        "I'll tell you here when they decide.",
      ].join("\n"),
    );
  });

  it("names an in-person place, and leaves out a missing purpose", () => {
    const text = agreementNoticeText({ ...summary, location: "Cafe Onion", mode: "in_person", purpose: null });
    expect(text).toContain("- Where: In person at Cafe Onion");
    expect(text).not.toContain("Purpose:");
  });

  it("says a booked meeting stands while a change waits for approval", () => {
    const text = agreementNoticeText({ ...summary, changesBooking: true });
    expect(text).toContain("Your booked meeting stays as it is until then.");
    expect(text).not.toContain("not booked");
  });

  it("carries no link", () => {
    expect(agreementNoticeText(summary)).not.toMatch(/https?:\/\//);
  });
});

describe("reading the agreed version", () => {
  function queryable(rows: unknown[]) {
    const seen: string[] = [];
    const q = ((strings: TemplateStringsArray) => {
      seen.push(strings.join("?"));
      return Promise.resolve(rows);
    }) as unknown as Queryable;
    return { q, seen };
  }

  it("reads only an agreed version, and falls back to UTC and Your host", async () => {
    const { q, seen } = queryable([
      {
        changes_booking: false,
        end_at: new Date("2026-11-30T02:00:00Z"),
        host_name: null,
        location: "ignored online",
        mode: "online",
        purpose: " ",
        requester_name: "Grace",
        start_at: new Date("2026-11-30T01:00:00Z"),
        timezone: "Not/AZone",
      },
    ]);
    const read = await readAgreementSummary(q, "request", 3);
    expect(read).toMatchObject({ durationMinutes: 60, hostName: "Your host", location: null, purpose: null, timezone: "UTC", version: 3 });
    expect(seen[0]).toContain("from app.agreements a where a.proposal_id = p.id");
  });

  it("is null without an agreement row", async () => {
    expect(await readAgreementSummary(queryable([]).q, "request", 1)).toBeNull();
  });
});

describe("the agreement notice's identity", () => {
  it("is one per version and binding", () => {
    expect(guestNoticeKey("r1", { bindingId: "b1", kind: "agreement_sent", version: 2 })).toBe("guest-notice:agreement_sent:r1:v2:b1");
    expect(guestNoticeKey("r1", { bindingId: "b2", kind: "agreement_sent", version: 2 })).not.toBe(
      guestNoticeKey("r1", { bindingId: "b1", kind: "agreement_sent", version: 2 }),
    );
  });
});
