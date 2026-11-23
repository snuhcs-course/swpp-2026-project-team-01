import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AwaitingCard, type RequesterCardContext } from "./cards";

const noop = () => {};

function context(reopenedBy: "host" | "requester" | null): RequesterCardContext {
  return {
    bookingId: "booking",
    chooseAnotherTime: noop,
    closeDetails: noop,
    focusCard: noop,
    onAgreed: noop,
    onAgreementFailure: noop,
    openDetails: noop,
    refresh: async () => {},
    run: async () => ({ ok: true }) as never,
    timezone: "Asia/Seoul",
    view: {
      agreement: null,
      booking: null,
      host: { displayName: "Haesung Choi", handle: "haesung" },
      proposal: null,
      reopenedBy,
      request: { details: {}, revision: 3, state: "negotiating" },
    } as unknown as RequesterCardContext["view"],
  };
}

// The line left where the wait for the host was, once an agreed request is
// back to choosing a time (#321).
describe("AwaitingCard after the agreed time reopened", () => {
  it("names the host when the host suggested another time", () => {
    const html = renderToStaticMarkup(<AwaitingCard context={context("host")} />);

    expect(html).toContain("Haesung Choi suggested another time · nothing is booked yet");
    expect(html).not.toContain("You reopened");
  });

  it("keeps the guest's own line after their Change", () => {
    const html = renderToStaticMarkup(<AwaitingCard context={context("requester")} />);

    expect(html).toContain("You reopened the agreed time to change it · nothing is booked yet");
    expect(html).not.toContain("suggested another time");
  });
});
