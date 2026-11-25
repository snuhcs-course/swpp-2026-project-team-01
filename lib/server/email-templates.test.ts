import { describe, expect, it } from "vitest";
import { renderEmail } from "./email-templates";

const bookingUrl = "https://findmeatime.com/booking/6f1c2b9e-0d4a-4f1e-8a59-3c3a4b5d6e7f";
const confirmUrl = "https://findmeatime.com/booking/confirm/abcdefghijklmnopqrstuvwxyz012345";

describe("email templates", () => {
  it.each(["en", "ko"] as const)("renders creation email in English for a %s request", (language) => {
    const email = renderEmail("request_creation", language, { hostName: "Ada", requesterName: "Grace" }, { bookingUrl, confirmUrl });

    for (const body of [email.html, email.text]) {
      expect(body).toContain(bookingUrl);
      expect(body).toContain(confirmUrl);
    }
    expect(email.subject).toContain("Ada");
    expect(email.html).toContain('lang="en"');
    expect(email.text).toContain("Optional email confirmation");
  });

  it("uses the same English actions for booking and optional email confirmation", () => {
    const email = renderEmail("request_creation", "ko", {}, { bookingUrl, confirmUrl });
    expect(email.text).toContain("Continue my request");
    expect(email.text).toContain("Confirm email address");
    expect(email.text).toContain("This step is optional");
    expect(email.html).toContain("#2C3E63");
  });

  it("leaves out the confirmation link for an address already confirmed", () => {
    const email = renderEmail("request_creation", "en", { hostName: "Ada" }, { bookingUrl });

    expect(email.text).not.toContain("Confirm this address");
    expect(email.html).not.toContain("/booking/confirm/");
  });

  it.each(["en", "ko"] as const)("renders the %s link resend with only the booking link", (language) => {
    const email = renderEmail("link_resend", language, { hostName: "Ada" }, { bookingUrl });

    expect(email.text).toContain(bookingUrl);
    expect(email.html).not.toContain("/booking/confirm/");
    expect(email.html).toContain('lang="en"');
  });

  it("escapes parameters in HTML", () => {
    const email = renderEmail("request_creation", "en", { hostName: "<script>x</script>" }, { bookingUrl });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("renders the separate agreement receipt with the agreed details and no confirmation action", () => {
    const email = renderEmail("agreement_receipt", "ko", {
      version: 1,
      changesBooking: false,
      hostName: "Ada",
      requesterName: "Grace",
      purpose: "Review the plan",
      start: "2026-11-02T01:00:00.000Z",
      end: "2026-11-02T01:30:00.000Z",
      timezone: "Asia/Seoul",
      durationMinutes: 30,
      mode: "online",
      location: null,
    }, { bookingUrl, confirmUrl });

    expect(email.subject).toBe("Your request is awaiting host approval");
    expect(email.html).toContain('lang="en"');
    expect(email.html).toContain('font-size:15px;line-height:24px">Hi Grace,');
    expect(email.text).toContain("Your request was successfully sent to the host and is awaiting approval.");
    expect(email.html).toContain("approval. The booking is not confirmed yet, and we’ll let you know once the host approves it and the booking is confirmed.");
    expect(email.text).toContain("Review the plan");
    expect(email.text).toContain("Asia/Seoul");
    expect(email.text).toContain("30 minutes");
    expect(email.text).toContain("Meeting type: Online");
    expect(email.text).toContain(`View request: ${bookingUrl}`);
    expect(email.html).not.toContain(confirmUrl);
    expect(email.text).not.toContain("Confirm email address");
  });

  it("keeps an existing booking confirmed while a change waits for approval", () => {
    const email = renderEmail("agreement_receipt", "en", {
      version: 2, changesBooking: true, hostName: "Ada", requesterName: "Grace",
      purpose: null, start: "2026-11-02T01:00:00.000Z", end: "2026-11-02T01:30:00.000Z",
      timezone: "Asia/Seoul", durationMinutes: 30, mode: "in_person", location: "SNU",
    }, { bookingUrl });

    expect(email.subject).toBe("Your change request is awaiting host approval");
    expect(email.text).toContain("Your existing booking remains confirmed");
    expect(email.text).toContain("Where: SNU");
    expect(email.text).not.toContain("The booking is not confirmed yet");
  });
});
