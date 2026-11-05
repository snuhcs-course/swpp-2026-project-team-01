import { describe, expect, it } from "vitest";
import {
  askChannels,
  channelName,
  deviceKind,
  displayWhatsAppNumber,
  isMessagingChannel,
  shownChannel,
  switchChannels,
  telegramLinkFor,
  whatsAppLinkFor,
} from "./messaging-channel";

// Which channel a device is offered across iMessage, WhatsApp and Telegram (host-whatsapp-channel D7,
// host-telegram-channel D7), the wa.me link (WhatsApp D6) and the t.me start link (Telegram D6).

const agents = {
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
};

const all = { imessage: "+15550001111", telegram: "findmeatime_bot", whatsapp: "15550002222" };
const noWhatsApp = { ...all, whatsapp: null };

describe("deviceKind", () => {
  it("tells Android, Apple devices and other computers apart", () => {
    expect(deviceKind(agents.android)).toBe("android");
    expect(deviceKind(agents.iphone)).toBe("apple");
    expect(deviceKind(agents.ipad)).toBe("apple");
    expect(deviceKind(agents.windows)).toBe("other");
    expect(deviceKind(agents.linux)).toBe("other");
  });
});

describe("isMessagingChannel", () => {
  it("accepts the three channels and nothing else", () => {
    expect(["imessage", "whatsapp", "telegram"].every(isMessagingChannel)).toBe(true);
    expect(isMessagingChannel("sms")).toBe(false);
    expect(isMessagingChannel(null)).toBe(false);
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

describe("telegramLinkFor", () => {
  it("builds the bot's start link with the code as its payload", () => {
    expect(telegramLinkFor("findmeatime_bot", "FMAT-ABCDEFGHJK")).toBe("https://t.me/findmeatime_bot?start=FMAT-ABCDEFGHJK");
    expect(telegramLinkFor("@findmeatime_bot", "FMAT-ABCDEFGHJK")).toBe("https://t.me/findmeatime_bot?start=FMAT-ABCDEFGHJK");
  });

  it("refuses a username or a payload Telegram would not take", () => {
    expect(telegramLinkFor("", "FMAT-ABCDEFGHJK")).toBeNull();
    expect(telegramLinkFor("bot", "FMAT-ABCDEFGHJK")).toBeNull();
    expect(telegramLinkFor("findmeatime_bot", "FMAT ABC")).toBeNull();
    expect(telegramLinkFor("findmeatime_bot", "x".repeat(65))).toBeNull();
    expect(telegramLinkFor("findmeatime_bot", "")).toBeNull();
  });
});

describe("shownChannel", () => {
  it("gives Android WhatsApp when configured and Telegram otherwise", () => {
    expect(shownChannel("android", all)).toBe("whatsapp");
    expect(shownChannel("android", noWhatsApp)).toBe("telegram");
  });

  it("gives Apple devices iMessage, and asks on other computers until the host chooses", () => {
    expect(shownChannel("apple", all)).toBe("imessage");
    expect(shownChannel("other", all)).toBeNull();
    expect(shownChannel("other", all, "telegram")).toBe("telegram");
    expect(shownChannel("apple", all, "telegram")).toBe("telegram");
  });

  it("goes straight to the only configured channel, and never to one that is not configured", () => {
    expect(shownChannel("other", { imessage: null, telegram: "findmeatime_bot", whatsapp: null })).toBe("telegram");
    expect(shownChannel("apple", { imessage: null, telegram: "findmeatime_bot", whatsapp: null })).toBe("telegram");
    expect(shownChannel("android", { imessage: "+15550001111", telegram: null, whatsapp: null })).toBe("imessage");
    expect(shownChannel("apple", { imessage: "+15550001111", telegram: null, whatsapp: null }, "whatsapp")).toBe("imessage");
    expect(shownChannel("other", { imessage: null, telegram: null, whatsapp: null })).toBeNull();
  });
});

describe("switchChannels", () => {
  it("offers Android the other of WhatsApp and Telegram, never iMessage", () => {
    expect(switchChannels("android", all, "whatsapp")).toEqual(["telegram"]);
    expect(switchChannels("android", all, "telegram")).toEqual(["whatsapp"]);
    expect(switchChannels("android", noWhatsApp, "telegram")).toEqual([]);
  });

  it("offers Apple devices Telegram, then WhatsApp, each if configured", () => {
    expect(switchChannels("apple", all, "imessage")).toEqual(["telegram", "whatsapp"]);
    expect(switchChannels("apple", noWhatsApp, "imessage")).toEqual(["telegram"]);
    expect(switchChannels("apple", { ...all, telegram: null }, "imessage")).toEqual(["whatsapp"]);
    expect(switchChannels("apple", all, "telegram")).toEqual(["imessage", "whatsapp"]);
  });

  it("offers other computers every other configured channel", () => {
    expect(switchChannels("other", all, "whatsapp")).toEqual(["imessage", "telegram"]);
    expect(switchChannels("other", noWhatsApp, "imessage")).toEqual(["telegram"]);
  });
});

describe("askChannels", () => {
  it("lists only the configured channels", () => {
    expect(askChannels(all)).toEqual(["imessage", "whatsapp", "telegram"]);
    expect(askChannels(noWhatsApp)).toEqual(["imessage", "telegram"]);
  });
});

describe("channelName", () => {
  it("names each channel", () => {
    expect(channelName("imessage")).toBe("iMessage");
    expect(channelName("whatsapp")).toBe("WhatsApp");
    expect(channelName("telegram")).toBe("Telegram");
  });
});
