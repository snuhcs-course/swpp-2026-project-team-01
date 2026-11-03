import { describe, expect, it } from "vitest";
import { deliveryNotice } from "./imessage-card";

// The linked card's delivery notice (host-whatsapp-channel design 7 and 8): WhatsApp's closed window and an
// unavailable template have their own words; any other failed or uncertain send keeps the iMessage wording.

const at = "2026-11-03T09:30:00.000Z";

describe("deliveryNotice", () => {
  it("says a closed WhatsApp window and an unavailable template in their own words", () => {
    expect(deliveryNotice({ at, reason: "window_closed", state: "failed" }, "WhatsApp")).toBe(
      "Not sent on WhatsApp: you haven't written for a day. Send Thyme any message to pick up here, or check your requests below.",
    );
    expect(deliveryNotice({ at, reason: "template_unavailable", state: "failed" }, "WhatsApp")).toBe(
      "A WhatsApp notice couldn't be sent. Your requests are all here in Find Me a Time.",
    );
  });

  it("keeps the failed and uncertain wording otherwise, naming the channel", () => {
    expect(deliveryNotice({ at, reason: null, state: "failed" }, "iMessage")).toMatch(
      /^A message to your iMessage couldn't be delivered at .+\. Continue here; nothing about your requests changed\.$/,
    );
    expect(deliveryNotice({ at, reason: null, state: "uncertain" }, "WhatsApp")).toMatch(
      /^A message to your WhatsApp at .+ may not have arrived\. Continue here; nothing about your requests changed\.$/,
    );
  });
});
