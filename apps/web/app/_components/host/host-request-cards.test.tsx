import type { HostRequestView, HostSuggestion } from "@lib/contracts/host-request";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { nextHostStep, ProposalReviewCard, SuggestionCard } from "./host-request-cards";

// After the host shares a new time, the request page shows that time as what
// the guest is now asked about, not the earlier proposal (#386).
const earlier = { agreedAt: null, durationMinutes: 30, end: "2026-11-27T04:30:00.000Z", linkPlan: null, location: "강남역", mode: "in_person", start: "2026-11-27T04:00:00.000Z", version: 1 };
const suggested = { ...earlier, end: "2026-11-27T12:30:00.000Z", start: "2026-11-27T12:00:00.000Z", version: 2 };

const suggestion = (overrides: Partial<HostSuggestion>): HostSuggestion => ({
  baseProposalVersion: 1,
  changes: { start: "2026-11-27T12:00:00.000Z" },
  id: "s1",
  proposalVersion: null,
  rejectionReason: null,
  source: "host",
  state: "pending",
  ...overrides,
});

const view = (overrides: Partial<HostRequestView> = {}) =>
  ({
    booking: null,
    details: { durationMinutes: 30, linkPlan: null, location: "강남역", mode: "in_person", purpose: null, windows: [] },
    evaluation: null,
    hostTimezone: "Asia/Seoul",
    proposal: earlier,
    requestId: "r1",
    requester: { email: null, emailConfirmed: false, language: "en", name: "Grace Hopper", timezone: "Asia/Seoul" },
    sample: false,
    state: "negotiating",
    suggestion: null,
    ...overrides,
  }) as unknown as HostRequestView;

const context = (request: HostRequestView) => ({ run: async () => ({ ok: true as const }), view: request });
const noop = () => undefined;

describe("the host's request page after a suggestion", () => {
  it("shows the shared time as the host's suggestion, waiting for the guest", () => {
    const shared = view({ proposal: suggested, suggestion: suggestion({ proposalVersion: 2, state: "shared" }) } as never);
    expect(nextHostStep(shared, false)).toBe("proposal");

    const html = renderToStaticMarkup(<ProposalReviewCard context={context(shared)} onRequestChanges={noop} />);
    expect(html).toContain("Waiting for Grace Hopper");
    expect(html).toContain("You suggested Fri 27 Nov, 21:00–21:30. We’re waiting for Grace Hopper to agree before you can approve.");
    expect(html).toContain("21:00 – 21:30");
    expect(html).not.toContain("13:00");
    // The host can still change or decline while waiting.
    expect(html).toContain("Request changes");
    expect(html).toContain("Decline");
  });

  it("says revised details rather than a time when the suggestion kept the time", () => {
    const placeOnly = view({ proposal: { ...earlier, location: "역삼역", version: 2 }, suggestion: suggestion({ changes: { location: "역삼역" }, proposalVersion: 2, state: "shared" }) } as never);
    const html = renderToStaticMarkup(<ProposalReviewCard context={context(placeOnly)} onRequestChanges={noop} />);
    expect(html).toContain("You shared revised details. We’re waiting for Grace Hopper to agree before you can approve.");
    expect(html).not.toContain("You suggested");
  });

  it("goes back to the usual proposal once the guest agrees or picks another time", () => {
    const agreed = view({ proposal: { ...suggested, agreedAt: "2026-11-24T00:00:00.000Z" }, state: "awaiting_host_approval", suggestion: suggestion({ proposalVersion: 2, state: "shared" }) } as never);
    expect(renderToStaticMarkup(<ProposalReviewCard context={context(agreed)} onRequestChanges={noop} />)).toContain("Approve this meeting?");

    const newer = view({ proposal: { ...suggested, version: 3 }, suggestion: suggestion({ proposalVersion: 2, state: "shared" }) } as never);
    const html = renderToStaticMarkup(<ProposalReviewCard context={context(newer)} onRequestChanges={noop} />);
    expect(html).toContain("Waiting for the requester");
    expect(html).not.toContain("You suggested");
  });

  it("shows a rejected time over the stale proposal it was made against", () => {
    const rejected = view({ suggestion: suggestion({ rejectionReason: "That time is outside your meeting hours.", state: "rejected" }) });
    expect(nextHostStep(rejected, false)).toBe("suggestion");

    const html = renderToStaticMarkup(<SuggestionCard context={context(rejected)} onRequestChanges={noop} />);
    expect(html).toContain("That time does not work");
    expect(html).toContain("That time is outside your meeting hours.");
    expect(html).toContain("You suggested Fri 27 Nov, 21:00 GMT+9 to 21:30 GMT+9");
    expect(html).toContain("the earlier time no longer stands");
  });

  it("leaves an older rejection behind once a newer proposal exists", () => {
    const later = view({ proposal: { ...earlier, version: 2 }, suggestion: suggestion({ state: "rejected" }) } as never);
    expect(nextHostStep(later, false)).toBe("proposal");
    expect(nextHostStep(view({ state: "declined", suggestion: suggestion({ state: "rejected" }) }), false)).toBe("proposal");
  });

  it("keeps a suggestion being checked or reviewed first", () => {
    expect(nextHostStep(view({ suggestion: suggestion({ state: "checking" }) }), false)).toBe("suggestion");
    expect(nextHostStep(view({ suggestion: suggestion({ state: "pending" }) }), false)).toBe("suggestion");
  });
});
