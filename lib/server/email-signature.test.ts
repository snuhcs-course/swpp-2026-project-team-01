import { describe, expect, it } from "vitest";
import { thymeAvatarUrl } from "../contracts/thyme-avatar";
import { renderAccountEmail } from "./account-emails";
import { type BookingEmailParameters, renderBookingEmail } from "./booking-emails";
import { emailSignatureHtml } from "./email-signature";
import { renderEmail } from "./email-templates";

const meeting: BookingEmailParameters = {
  audience: "requester",
  durationMinutes: 30,
  end: "2026-11-02T01:30:00.000Z",
  hostEmail: "ada@example.test",
  hostName: "Ada Lovelace",
  joinUrl: "https://meet.google.com/abc-defg-hij",
  location: null,
  mode: "online",
  organizerEmail: "ada@example.test",
  organizerName: "Ada Lovelace",
  requesterEmail: "grace@example.test",
  requesterName: "Grace Hopper",
  start: "2026-11-02T01:00:00.000Z",
  timezone: "Asia/Seoul",
  title: "Talk about compilers",
};

describe("email signature", () => {
  it("signs off as Thyme with the chosen profile picture from the public host", () => {
    const html = emailSignatureHtml();
    expect(thymeAvatarUrl(128)).toBe("https://findmeatime.com/thyme/blue-128.png");
    expect(html).toContain(`<img src="${thymeAvatarUrl(128)}" width="44" height="44" alt=""`);
    expect(html).toContain(">Thyme</span>");
    expect(html).toContain(">Find Me a Time</span>");
  });

  it("appears in the request, account and booking emails", () => {
    const request = renderEmail("link_resend", "en", { hostName: "Ada" }, { bookingUrl: "https://findmeatime.com/booking/x" });
    const account = renderAccountEmail("account_deletion_cancelled", "en", { appUrl: "https://findmeatime.com/app", hostAccountId: "00000000-0000-4000-8000-000000000001" });
    const booking = renderBookingEmail("booking_confirmation", "en", meeting, { bookingUrl: "https://findmeatime.com/booking/x" });
    for (const email of [account, booking]) {
      expect(email.html).toContain(emailSignatureHtml());
      expect(email.html).not.toContain(`<p style="color:#555;font-size:14px">Find Me a Time</p>`);
    }
    // The card emails sign in above the greeting rather than at the foot.
    const signature = request.html.indexOf(emailSignatureHtml("0 0 18px"));
    expect(signature).toBeGreaterThan(request.html.indexOf("</h1>"));
    expect(signature).toBeLessThan(request.html.indexOf(">Hi,</p>"));
    expect(request.html.split(">Thyme</span>")).toHaveLength(2);
  });
});
