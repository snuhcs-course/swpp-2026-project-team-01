import { describe, expect, it } from "vitest";
import { deepLinkFor, linkMessage, maskSender, messagesPlatform, normalizeNumber, qrDeepLink } from "./imessage";

// The one-tap deep link (host-imessage-channel design 5, D4): which platforms
// open Messages, the body separator each expects, and the masked sender and
// number the card shows.

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

describe("messagesPlatform", () => {
  it("opens Messages on iPhone, iPad (also with a Macintosh user agent and touch) and Android", () => {
    expect(messagesPlatform(IPHONE)).toBe("ios");
    expect(messagesPlatform(IPAD_DESKTOP, 5)).toBe("ios");
    expect(messagesPlatform(ANDROID)).toBe("android");
  });

  it("shows the inline card on desktops, macOS included", () => {
    expect(messagesPlatform(IPAD_DESKTOP, 0)).toBe("other");
    expect(messagesPlatform(WINDOWS)).toBe("other");
  });
});

describe("deepLinkFor", () => {
  const text = linkMessage("FMAT-7KQ2M9XD3A");

  it("uses &body= on iOS and ?body= on Android, percent-encoding the message", () => {
    expect(text).toBe("Link my Find Me a Time account: FMAT-7KQ2M9XD3A");
    expect(deepLinkFor("ios", "+15550001111", text)).toBe("sms:+15550001111&body=Link%20my%20Find%20Me%20a%20Time%20account%3A%20FMAT-7KQ2M9XD3A");
    expect(deepLinkFor("android", "+15550001111", text)).toBe("sms:+15550001111?body=Link%20my%20Find%20Me%20a%20Time%20account%3A%20FMAT-7KQ2M9XD3A");
    expect(deepLinkFor("other", "+15550001111", text)).toBeNull();
  });

  it("puts the iOS form in the QR code", () => {
    expect(qrDeepLink("+15550001111", text)).toBe(deepLinkFor("ios", "+15550001111", text));
  });
});

describe("maskSender and normalizeNumber", () => {
  it("shows the last four digits of a number and the first character and domain of an email", () => {
    expect(maskSender("+15551234567")).toBe("•••• 4567");
    expect(maskSender("host@icloud.com")).toBe("h•••@icloud.com");
  });

  it("accepts an E.164 number written with spaces or dashes and refuses anything else", () => {
    expect(normalizeNumber("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizeNumber("+82 10.1234.5678")).toBe("+821012345678");
    expect(normalizeNumber("555 123 4567")).toBeNull();
    expect(normalizeNumber("+0123456789")).toBeNull();
  });
});
