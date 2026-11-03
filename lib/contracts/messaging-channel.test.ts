import { describe, expect, it } from "vitest";
import { channelName, channelOffer, displayWhatsAppNumber, otherChannel, shownChannel, whatsAppLinkFor } from "./messaging-channel";

// Which channel a device is offered (host-whatsapp-channel D7) and the wa.me link (D6).

const agents = {
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
};

describe("channelOffer", () => {
  it("offers WhatsApp on Android, iMessage on Apple devices and asks elsewhere", () => {
    expect(channelOffer(agents.android)).toBe("whatsapp");
    expect(channelOffer(agents.iphone)).toBe("imessage");
    expect(channelOffer(agents.ipad)).toBe("imessage");
    expect(channelOffer(agents.windows)).toBe("ask");
    expect(channelOffer(agents.linux)).toBe("ask");
  });
});

describe("whatsAppLinkFor", () => {
  it("builds wa.me with the digits and the encoded message", () => {
    expect(whatsAppLinkFor("+15550001111", "Link my Find Me a Time account: FMAT-ABCDEFGHJK")).toBe(
      "https://wa.me/15550001111?text=Link%20my%20Find%20Me%20a%20Time%20account%3A%20FMAT-ABCDEFGHJK",
    );
  });

  it("refuses a number that is not one", () => {
    expect(whatsAppLinkFor("", "x")).toBeNull();
    expect(whatsAppLinkFor("1-555", "x")).toBeNull();
  });

  it("shows the number with a plus", () => {
    expect(displayWhatsAppNumber("15550001111")).toBe("+15550001111");
  });
});

describe("shownChannel", () => {
  const both = { imessage: "+15550001111", whatsapp: "15550002222" };

  it("follows the device, and asks on other computers until the host chooses", () => {
    expect(shownChannel("whatsapp", both)).toBe("whatsapp");
    expect(shownChannel("imessage", both)).toBe("imessage");
    expect(shownChannel("ask", both)).toBeNull();
    expect(shownChannel("ask", both, "whatsapp")).toBe("whatsapp");
    expect(shownChannel("imessage", both, "whatsapp")).toBe("whatsapp");
  });

  it("goes straight to the only configured channel", () => {
    expect(shownChannel("ask", { imessage: null, whatsapp: "15550002222" })).toBe("whatsapp");
    expect(shownChannel("whatsapp", { imessage: "+15550001111", whatsapp: null })).toBe("imessage");
    expect(shownChannel("imessage", { imessage: "+15550001111", whatsapp: null }, "whatsapp")).toBe("imessage");
    expect(shownChannel("ask", { imessage: null, whatsapp: null })).toBeNull();
  });
});

describe("otherChannel", () => {
  const both = { imessage: "+15550001111", whatsapp: "15550002222" };

  it("offers the other configured channel, never on Android", () => {
    expect(otherChannel("imessage", both, "imessage")).toBe("whatsapp");
    expect(otherChannel("imessage", both, "whatsapp")).toBe("imessage");
    expect(otherChannel("ask", both, "whatsapp")).toBe("imessage");
    expect(otherChannel("whatsapp", both, "whatsapp")).toBeNull();
    expect(otherChannel("imessage", { imessage: "+15550001111", whatsapp: null }, "imessage")).toBeNull();
  });
});

describe("channelName", () => {
  it("names each channel", () => {
    expect(channelName("imessage")).toBe("iMessage");
    expect(channelName("whatsapp")).toBe("WhatsApp");
  });
});
