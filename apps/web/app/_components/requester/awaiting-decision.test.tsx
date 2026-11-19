import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AwaitingDecisionDetails } from "./cards";

describe("AwaitingDecisionDetails", () => {
  it("names the approval state and decision channels without claiming an email was sent", () => {
    const html = renderToStaticMarkup(<AwaitingDecisionDetails email="grace@example.test" />);

    expect(html).toContain("Your meeting request has been submitted.");
    expect(html).not.toContain("Nothing is booked yet");
    expect(html).toContain("You’ll receive an email at");
    expect(html).toContain("as soon as the host approves your request. You can also link");
    expect(html).toContain("grace@example.test");
    expect(html).toContain("iMessage or Telegram");
    expect(html).not.toContain("We sent a copy of your agreement");
  });

  it("names the actual recipient when the agreement email reports a confirmed send", () => {
    const html = renderToStaticMarkup(
      <AwaitingDecisionDetails agreementEmailSentTo="new-address@example.test" email="grace@example.test" />,
    );

    expect(html).toContain("We sent a copy of your agreement to");
    expect(html).toContain("new-address@example.test");
  });
});
