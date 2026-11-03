import type { InboundMessage } from "./photon-receiver";

// WhatsApp Business on the shared Photon webhook (host-whatsapp-channel design 2
// and 3, D2, D3). The receiver verifies a delivery once and offers the payload to
// the iMessage parser, which takes only iMessage (PR #63), and then to this one,
// which takes only WhatsApp Business: at least one platform field must be
// present and every one present must normalize to "whatsappbusiness", so an
// unlabelled event or one that mixes platforms matches neither. The provider
// (@spectrum-ts/whatsapp-business 12.14.0) maps an inbound message to
// sender.id = space.id = the WhatsApp contact ID, the international number as
// digits without "+"; a conversation whose ID is not its sender, or a group, is
// not a host's private conversation. The exact spelling Photon writes is
// confirmed from a real event at the join (task 5.1).

export const WHATSAPP_PLATFORM = "whatsapp_business";

function normalizedPlatform(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isWhatsAppEvent(...platforms: unknown[]) {
  const named = platforms.filter((value) => value !== undefined && value !== null);
  return named.length > 0 && named.every((value) => typeof value === "string" && normalizedPlatform(value) === "whatsappbusiness");
}

const CONTACT_ID = /^[1-9]\d{7,14}$/;

// The WhatsApp contact ID (D3): one leading "+" is dropped, then 8 to 15 digits
// not starting with 0. Anything else is not a sender.
export function normalizeWhatsAppSender(value: unknown) {
  if (typeof value !== "string") return null;
  const digits = value.trim().replace(/^\+/, "");
  return CONTACT_ID.test(digits) ? digits : null;
}

function text(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

// The inbound WhatsApp message of a `messages` event, or null for any other
// event or platform, an outbound echo, a group, or a payload without its locators.
export function inboundWhatsAppMessage(payload: unknown): InboundMessage | null {
  if (!payload || typeof payload !== "object") return null;

  const event = payload as { event?: unknown; message?: unknown; space?: unknown };
  if (event.event !== "messages" || !event.message || typeof event.message !== "object") return null;

  const message = event.message as {
    id?: unknown;
    direction?: unknown;
    platform?: unknown;
    sender?: { id?: unknown; platform?: unknown } | null;
    space?: { id?: unknown; type?: unknown; platform?: unknown } | null;
    content?: { type?: unknown; text?: unknown } | null;
    timestamp?: unknown;
  };
  const space = (event.space && typeof event.space === "object" ? event.space : message.space) as
    | { id?: unknown; type?: unknown; platform?: unknown }
    | null
    | undefined;

  if (message.direction !== "inbound") return null;
  if (!isWhatsAppEvent(message.platform, space?.platform, message.space?.platform, message.sender?.platform)) return null;

  const messageId = text(message.id, 500);
  const sender = normalizeWhatsAppSender(message.sender?.id);
  const spaceId = normalizeWhatsAppSender(space?.id);
  const contentType = text(message.content?.type, 50);

  if (contentType === "read" || contentType === "typing") return null;
  if (!messageId || !sender || !contentType) return null;
  // One-to-one only: the conversation is the sender, and a type, if given, is dm.
  if (spaceId !== sender || (space?.type !== undefined && space.type !== "dm")) return null;

  const sentAt = typeof message.timestamp === "string" && !Number.isNaN(Date.parse(message.timestamp)) ? new Date(message.timestamp) : null;
  const body = contentType === "text" && typeof message.content?.text === "string" ? message.content.text : null;

  return { channel: "whatsapp", contentType, messageId, sender, sentAt, spaceId, spaceType: "dm", text: body };
}
