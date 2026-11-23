import { describe, expect, it } from "vitest";
import { deepLinkFor, IMESSAGE_OPERATIONS, linkMessage, displaySender, maskedSender, messagesPlatform, normalizeNumber, qrDeepLink } from "./imessage";
import { REQUESTER_IMESSAGE_OPERATIONS } from "./requester-imessage";

// The one-tap deep link (host-imessage-channel design 5, D4): which platforms
// open Messages, the body separator each expects, and the sender and number
// the card shows in full.

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

  it("tells a Mac (a Macintosh user agent without touch) from other desktops", () => {
    expect(messagesPlatform(IPAD_DESKTOP, 0)).toBe("mac");
    expect(messagesPlatform(WINDOWS)).toBe("other");
  });
});

describe("deepLinkFor", () => {
  const text = linkMessage("FMAT-7KQ2M9XD3A");

  it("uses &body= on iOS and a Mac and ?body= on Android, percent-encoding the message", () => {
    expect(text).toBe("Link my Find Me a Time account: FMAT-7KQ2M9XD3A");
    expect(deepLinkFor("ios", "+15550001111", text)).toBe("sms:+15550001111&body=Link%20my%20Find%20Me%20a%20Time%20account%3A%20FMAT-7KQ2M9XD3A");
    expect(deepLinkFor("android", "+15550001111", text)).toBe("sms:+15550001111?body=Link%20my%20Find%20Me%20a%20Time%20account%3A%20FMAT-7KQ2M9XD3A");
    expect(deepLinkFor("mac", "+15550001111", text)).toBe(deepLinkFor("ios", "+15550001111", text));
    expect(deepLinkFor("other", "+15550001111", text)).toBeNull();
  });

  it("puts the iOS form in the QR code", () => {
    expect(qrDeepLink("+15550001111", text)).toBe(deepLinkFor("ios", "+15550001111", text));
  });
});

describe("displaySender and normalizeNumber", () => {
  it("shows the whole number, a WhatsApp contact ID with its plus, and the whole email", () => {
    expect(displaySender("+15551234567")).toBe("+15551234567");
    expect(displaySender("821025742625")).toBe("+821025742625");
    expect(displaySender("host@icloud.com")).toBe("host@icloud.com");
  });

  it("accepts an E.164 number written with spaces or dashes and refuses anything else", () => {
    expect(normalizeNumber("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizeNumber("+82 10.1234.5678")).toBe("+821012345678");
    expect(normalizeNumber("555 123 4567")).toBeNull();
    expect(normalizeNumber("+0123456789")).toBeNull();
  });
});

// A linked sender on screen (link-on-code D4): enough to recognize one's own
// number and press Not my number, without the whole number.
describe("maskedSender", () => {
  it("shows a number by its last four digits", () => {
    expect(maskedSender("+821012345678")).toBe("•••• 5678");
    expect(maskedSender("15551234567")).toBe("•••• 4567");
  });

  it("shows an Apple ID email as the handle it is", () => {
    expect(maskedSender("host@example.com")).toBe("host@example.com");
  });
});

// Nothing is confirmed in the browser any more (link-on-code D1).
describe("link operations", () => {
  it("has no confirm command for host or guest links", () => {
    expect(IMESSAGE_OPERATIONS.some((operation) => operation.includes("confirm"))).toBe(false);
    expect(Object.values(REQUESTER_IMESSAGE_OPERATIONS).some((operation) => operation.includes("confirm"))).toBe(false);
  });
});
