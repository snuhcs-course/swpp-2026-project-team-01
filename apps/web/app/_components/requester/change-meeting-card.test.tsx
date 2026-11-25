import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequesterCardContext } from "./cards";
import { CandidatesCard } from "./request-cards";

function context(changing: boolean, canCancel = changing): RequesterCardContext {
  return {
    bookingId: "booking", timezone: "Asia/Seoul",
    view: {
      evaluation: null, canCancelChanges: canCancel, reopenedBy: changing ? "requester" : null,
      request: { revision: 3, details: { purpose: "Coffee chat", durationMinutes: 30, mode: "online", language: "en" } },
    },
    run: async () => ({ ok: true }), refresh: async () => {}, openDetails: () => {}, closeDetails: () => {},
  } as unknown as RequesterCardContext;
}

describe("meeting change card", () => {
  it("offers time, detail and cancellation choices with the approved title", () => {
    const html = renderToStaticMarkup(<CandidatesCard context={context(true)} />);
    expect(html).toContain("What would you like to change?");
    expect(html).toContain("Find a new time");
    expect(html).toContain("Edit details");
    expect(html).toContain("Cancel changes");
    expect(html).toContain("keep your previous request");
    expect(html).not.toContain("Find times that work?");
  });

  it("does not offer a rollback when the previous details cannot be reconstructed", () => {
    const html = renderToStaticMarkup(<CandidatesCard context={context(true, false)} />);
    expect(html).toContain("What would you like to change?");
    expect(html).not.toContain("Cancel changes");
  });

  it("keeps first-time searches separate from editing an existing meeting", () => {
    const html = renderToStaticMarkup(<CandidatesCard context={context(false)} />);
    expect(html).toContain("Find times that work?");
    expect(html).not.toContain("Cancel changes");
  });
});
