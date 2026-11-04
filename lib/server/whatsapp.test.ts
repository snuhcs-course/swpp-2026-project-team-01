import { describe, expect, it } from "vitest";
import { channelHash, imessageHash, inboundMessage } from "./photon-receiver";
import { buttonCommand, inboundWhatsAppMessage, isWhatsAppEvent, metaErrorCode, normalizeWhatsAppSender, whatsAppSendFailure } from "./whatsapp";

// WhatsApp Business on the shared webhook (host-whatsapp-channel design 2 and 3):
// the platform check, the contact ID and the separate hash namespace.

const key = { id: "k1", key: Buffer.alloc(32, 7) };

const event = {
  event: "messages",
  message: {
    content: { text: "request K7Q2MX", type: "text" },
    direction: "inbound",
    id: "wamid.HBgLMTU1NTEyMzQ1NjcVAgASGBQzQTk",
    platform: "whatsapp_business",
    sender: { id: "15551234567", platform: "whatsapp_business" },
    space: { id: "15551234567", platform: "whatsapp_business" },
    timestamp: "2026-11-03T12:00:00.000Z",
  },
  space: { id: "15551234567", platform: "whatsapp_business" },
};

function withPlatform(platform: unknown) {
  return {
    ...event,
    message: { ...event.message, platform, sender: { ...event.message.sender, platform }, space: { ...event.message.space, platform } },
    space: { ...event.space, platform },
  };
}

describe("isWhatsAppEvent", () => {
  it.each(["whatsapp_business", "WhatsApp Business", "whatsappBusiness", "WHATSAPP-BUSINESS"])("takes %s", (platform) => {
    expect(isWhatsAppEvent(platform, undefined, null)).toBe(true);
  });

  it("refuses no platform, another platform, personal WhatsApp and a mix", () => {
    expect(isWhatsAppEvent(undefined, null)).toBe(false);
    expect(isWhatsAppEvent("iMessage")).toBe(false);
    expect(isWhatsAppEvent("whatsapp")).toBe(false);
    expect(isWhatsAppEvent("whatsapp_business", "iMessage")).toBe(false);
    expect(isWhatsAppEvent("whatsapp_business", 3)).toBe(false);
  });
});

describe("normalizeWhatsAppSender", () => {
  it("keeps the digits and drops one leading plus", () => {
    expect(normalizeWhatsAppSender("15551234567")).toBe("15551234567");
    expect(normalizeWhatsAppSender(" +821012345678 ")).toBe("821012345678");
  });

  it("refuses anything else", () => {
    expect(normalizeWhatsAppSender("015551234567")).toBeNull();
    expect(normalizeWhatsAppSender("1555123")).toBeNull();
    expect(normalizeWhatsAppSender("1555 123 4567")).toBeNull();
    expect(normalizeWhatsAppSender("++15551234567")).toBeNull();
    expect(normalizeWhatsAppSender("host@example.com")).toBeNull();
    expect(normalizeWhatsAppSender(15551234567)).toBeNull();
  });
});

describe("inboundWhatsAppMessage", () => {
  it("reads a direct text message", () => {
    expect(inboundWhatsAppMessage(event)).toEqual({
      channel: "whatsapp",
      contentType: "text",
      messageId: "wamid.HBgLMTU1NTEyMzQ1NjcVAgASGBQzQTk",
      sender: "15551234567",
      sentAt: new Date("2026-11-03T12:00:00.000Z"),
      spaceId: "15551234567",
      spaceType: "dm",
      text: "request K7Q2MX",
    });
  });

  it("takes each spelling of the platform", () => {
    expect(inboundWhatsAppMessage(withPlatform("WhatsApp Business"))?.channel).toBe("whatsapp");
  });

  it("drops an iMessage event, and the iMessage parser drops a WhatsApp one", () => {
    expect(inboundWhatsAppMessage(withPlatform("iMessage"))).toBeNull();
    expect(inboundMessage(event)).toBeNull();
  });

  it("drops an unlabelled event and one that mixes platforms", () => {
    expect(inboundWhatsAppMessage(withPlatform(undefined))).toBeNull();
    expect(inboundWhatsAppMessage({ ...event, space: { ...event.space, platform: "iMessage" } })).toBeNull();
  });

  it("drops a group and a conversation that is not its sender", () => {
    expect(inboundWhatsAppMessage({ ...event, space: { ...event.space, type: "group" } })).toBeNull();
    expect(inboundWhatsAppMessage({ ...event, space: { ...event.space, id: "15559999999" } })).toBeNull();
    expect(inboundWhatsAppMessage({ ...event, space: { ...event.space, type: "dm" } })?.spaceType).toBe("dm");
  });

  it("drops echoes, read and typing signals, and messages without locators", () => {
    expect(inboundWhatsAppMessage({ ...event, message: { ...event.message, direction: "outbound" } })).toBeNull();
    expect(inboundWhatsAppMessage({ ...event, message: { ...event.message, content: { type: "read" } } })).toBeNull();
    expect(inboundWhatsAppMessage({ ...event, message: { ...event.message, id: undefined } })).toBeNull();
    expect(inboundWhatsAppMessage({ ...event, message: { ...event.message, sender: { id: "+1 555", platform: "whatsapp_business" } } })).toBeNull();
    expect(inboundWhatsAppMessage({ event: "status", message: event.message })).toBeNull();
  });

  it("keeps other content without text", () => {
    const voice = inboundWhatsAppMessage({ ...event, message: { ...event.message, content: { type: "voice" } } });
    expect(voice).toMatchObject({ contentType: "voice", text: null });
  });
});

// host-whatsapp-channel design 11, D17: a tap is read from its ID, never its title.
describe("buttonCommand", () => {
  it("turns each ID into the exact command it names", () => {
    expect(buttonCommand("a:K7Q2MX-2")).toBe("approve K7Q2MX-2");
    expect(buttonCommand("d:k7q2mx-2")).toBe("decline K7Q2MX-2");
    expect(buttonCommand("s:K7Q2MX")).toBe("request K7Q2MX");
    expect(buttonCommand("c:0a1b2c3d")).toBe("confirm 0A1B2C3D");
  });

  it("names nothing for an ID without its version, another format or a title", () => {
    expect(buttonCommand("a:K7Q2MX")).toBeNull();
    expect(buttonCommand("s:K7Q2MX-2")).toBeNull();
    expect(buttonCommand("c:K7Q2MX")).toBeNull();
    expect(buttonCommand("opt_0")).toBeNull();
    expect(buttonCommand("Approve")).toBeNull();
    expect(buttonCommand("a:K7Q2MX-2 extra")).toBeNull();
    expect(buttonCommand(3)).toBeNull();
  });
});

describe("inboundWhatsAppMessage with a reply button", () => {
  const tap = (content: Record<string, unknown>) => inboundWhatsAppMessage({ ...event, message: { ...event.message, content } });

  it.each([
    ["Spectrum's custom content", { raw: { reply: { id: "a:K7Q2MX-2", title: "Decline" }, type: "button_reply", whatsapp_type: "interactive" }, type: "custom" }],
    ["an interactive with reply.id", { interactive: { reply: { id: "a:K7Q2MX-2", title: "Approve" }, type: "button_reply" }, type: "interactive" }],
    ["Meta's button_reply", { interactive: { button_reply: { id: "a:K7Q2MX-2", title: "Approve" }, type: "button_reply" }, type: "interactive" }],
    ["a button with an id", { id: "a:K7Q2MX-2", title: "Approve", type: "button" }],
    ["a button with a payload", { button: { payload: "a:K7Q2MX-2", text: "Approve" }, type: "button" }],
  ])("reads %s as the command its ID names", (_shape, content) => {
    expect(tap(content)).toMatchObject({ channel: "whatsapp", contentType: "button", text: "approve K7Q2MX-2" });
  });

  it("never reads the title, and names no command for an ID we did not set", () => {
    expect(tap({ interactive: { reply: { id: "opt_0", title: "approve K7Q2MX-2" }, type: "button_reply" }, type: "interactive" })).toMatchObject({
      contentType: "button",
      text: null,
    });
  });

  it("leaves other custom content alone", () => {
    expect(tap({ raw: { latitude: 1, longitude: 2, whatsapp_type: "location" }, type: "custom" })).toMatchObject({ contentType: "custom", text: null });
  });
});

describe("channelHash", () => {
  it("hashes WhatsApp in its own namespace and leaves iMessage hashes as they were", () => {
    expect(channelHash(key, "imessage", "sender", "+15551234567")).toBe(imessageHash(key, "sender", "+15551234567"));
    expect(channelHash(key, "whatsapp", "sender", "15551234567")).not.toBe(imessageHash(key, "sender", "15551234567"));
    expect(channelHash(key, "whatsapp", "sender", "15551234567")).not.toBe(channelHash(key, "imessage", "sender", "+15551234567"));
  });
});

describe("whatsAppSendFailure", () => {
  it("maps Meta's codes wherever the error carries them", () => {
    expect(whatsAppSendFailure(new Error("(#131047) Re-engagement message"))).toEqual({ category: "window_closed", status: "rejected" });
    expect(whatsAppSendFailure(Object.assign(new Error("failed"), { context: { metaCode: "131026" } }))).toEqual({ category: "undeliverable", status: "rejected" });
    expect(whatsAppSendFailure(new Error("send failed", { cause: { code: 132001, message: "Template name does not exist" } }))).toEqual({
      category: "template_unavailable",
      status: "rejected",
    });
    expect(whatsAppSendFailure(new Error("(#130429) Rate limit hit"))).toEqual({ status: "unavailable" });
    expect(whatsAppSendFailure(new Error("(#131056) Pair rate limit"))).toEqual({ status: "unavailable" });
  });

  it("maps the SDK's error classes and leaves anything else uncertain", () => {
    expect(whatsAppSendFailure(Object.assign(new Error("slow down"), { name: "RateLimitError" }))).toEqual({ status: "unavailable" });
    expect(whatsAppSendFailure(Object.assign(new Error("no"), { name: "AuthenticationError" }))).toEqual({ category: "provider_authentication", status: "rejected" });
    expect(whatsAppSendFailure(new Error("socket hang up"))).toEqual({ status: "uncertain" });
    expect(metaErrorCode(new Error("status 500"))).toBeNull();
  });
});
