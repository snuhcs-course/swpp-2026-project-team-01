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
});
