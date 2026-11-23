import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeEmailForm, type RequesterCardContext, SentLine } from "./cards";

const noop = () => {};

function context(delivery: string | null, confirmed = false): RequesterCardContext {
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
      confirmation: { confirmed, delivery, retryAt: null },
      connection: { calendar: false, calendarIds: [], canUseGoogleEmail: false, identity: false },
      contact: { confirmed, email: "grace@exmaple.test", name: "Grace" },
    } as unknown as RequesterCardContext["view"],
  };
}

// After a bounce the guest can change their address (guest-email-and-agree-notices
// design 1, #332); a delivered or confirmed address offers no change.
describe("the booking link status line", () => {
  it("offers Change email when the booking link bounced or was suppressed", () => {
    expect(renderToStaticMarkup(<SentLine context={context("rejected")} />)).toContain("Change email");
    expect(renderToStaticMarkup(<SentLine context={context("suppressed")} />)).toContain("Change email");
  });

  it("offers no change for a delivered or confirmed address", () => {
    expect(renderToStaticMarkup(<SentLine context={context("sent")} />)).not.toContain("Change email");
    expect(renderToStaticMarkup(<SentLine context={context("rejected", true)} />)).not.toContain("Change email");
  });

  it("asks where the link should go in a labelled email field", () => {
    const html = renderToStaticMarkup(<ChangeEmailForm busy={false} current="grace@exmaple.test" error={null} onCancel={noop} onSubmit={noop} />);
    expect(html).toContain("Your booking link could not be delivered to grace@exmaple.test. Where should it go?");
    expect(html).toMatch(/<input[^>]*type="email"/);
    expect(html).toContain("Send the link here");
  });
});
