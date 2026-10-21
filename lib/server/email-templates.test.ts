import { describe, expect, it } from "vitest";
import { renderEmail } from "./email-templates";

const bookingUrl = "https://findmeatime.com/booking/6f1c2b9e-0d4a-4f1e-8a59-3c3a4b5d6e7f";
const confirmUrl = "https://findmeatime.com/booking/confirm/abcdefghijklmnopqrstuvwxyz012345";

describe("email templates", () => {
  it.each(["en", "ko"] as const)("renders the %s creation email with both links in HTML and text", (language) => {
    const email = renderEmail("request_creation", language, { hostName: "Ada", requesterName: "Grace" }, { bookingUrl, confirmUrl });

    for (const body of [email.html, email.text]) {
      expect(body).toContain(bookingUrl);
      expect(body).toContain(confirmUrl);
    }
    expect(email.subject).toContain("Ada");
    expect(email.html).toContain(`lang="${language}"`);
  });

  it("names the actions in the request's language", () => {
    expect(renderEmail("request_creation", "en", {}, { bookingUrl, confirmUrl }).text).toContain("Confirm this address");
    expect(renderEmail("request_creation", "ko", {}, { bookingUrl, confirmUrl }).text).toContain("이 주소 확인하기");
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
  });

  it("escapes parameters in HTML", () => {
    const email = renderEmail("request_creation", "en", { hostName: "<script>x</script>" }, { bookingUrl });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
