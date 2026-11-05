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

// A tapped reply button's receipt content type (design 11, D17).
export const WHATSAPP_BUTTON_CONTENT = "button";

// Button IDs we set (D17), in the Telegram plan's format (#112):
//   a:<ref>-<version> approve, d:<ref>-<version> decline, s:<ref> show the
//   request, c:<settingsRef> confirm settings.
// The command is rebuilt from the ID alone; a title is never read.
const BUTTON_ID = /^([adsc]):([0-9A-Z]{6}(?:-[1-9]\d{0,5})?|[0-9A-F]{8})$/i;

export function buttonCommand(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const match = BUTTON_ID.exec(id.trim());
  if (!match) return null;
  const [, action, ref] = match as unknown as [string, string, string];
  const versioned = /^[0-9A-Z]{6}-\d+$/i.test(ref);
  switch (action.toLowerCase()) {
    case "a":
      return versioned ? `approve ${ref.toUpperCase()}` : null;
    case "d":
      return versioned ? `decline ${ref.toUpperCase()}` : null;
    case "s":
      return /^[0-9A-Z]{6}$/i.test(ref) ? `request ${ref.toUpperCase()}` : null;
    default:
      return /^[0-9A-F]{8}$/i.test(ref) ? `confirm ${ref.toUpperCase()}` : null;
  }
}

function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// The ID of a tapped reply button, or null when the content is not one.
// UNCONFIRMED (design 11, task 7.5): Photon's native webhook payload for a
// WhatsApp button reply has not been seen. Spectrum's provider maps Meta's
// interactive button_reply to custom content { whatsapp_type: "interactive",
// type: "button_reply", reply: { id, title } } when it holds no poll for it, and
// a template quick reply to { whatsapp_type: "button", payload, text }; Photon's
// webhook may instead relay Meta's own shape. Every plausible place is read:
// content.raw (Spectrum's custom content), content itself, content.interactive
// and content.button, each as { id }, { reply: { id } }, { button_reply: { id } }
// or { payload }. WHATSAPP_BUTTONS stays off until a real tap confirms one.
function tappedButtonId(content: unknown): string | null {
  const type = field(content, "type");
  if (type !== "custom" && type !== "button" && type !== "interactive") return null;

  const candidates = [field(content, "raw"), content, field(content, "interactive"), field(content, "button")];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const kind = field(candidate, "whatsapp_type") ?? field(candidate, "type");
    // Spectrum's custom content for anything else (a sticker, a location) is not a tap.
    if (type === "custom" && candidate === field(content, "raw") && kind !== "interactive" && kind !== "button") return null;
    if (field(candidate, "type") === "list_reply" || field(candidate, "type") === "nfm_reply") return null;
    for (const value of [
      field(candidate, "reply", "id"),
      field(candidate, "button_reply", "id"),
      field(candidate, "id"),
      field(candidate, "payload"),
    ]) {
      if (typeof value === "string" && value.length > 0 && value.length <= 256) return value;
    }
  }
  return null;
}

// The inbound WhatsApp message of a `messages` event, or null for any other
// event or platform, an outbound echo, a group, or a payload without its locators.
// A reply-button tap becomes content type "button" whose text is the exact
// command its ID names, or no text when the ID names none.
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
    content?: { type?: unknown; text?: unknown; [key: string]: unknown } | null;
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
  const buttonId = tappedButtonId(message.content);
  if (buttonId !== null) {
    return { channel: "whatsapp", contentType: WHATSAPP_BUTTON_CONTENT, messageId, sender, sentAt, spaceId, spaceType: "dm", text: buttonCommand(buttonId) };
  }

  const body = contentType === "text" && typeof message.content?.text === "string" ? message.content.text : null;

  return { channel: "whatsapp", contentType, messageId, sender, sentAt, spaceId, spaceType: "dm", text: body };
}

// ---------------------------------------------------------------------------
// Meta's refusals (design 9, D10)

export type WhatsAppSendFailure =
  | {
      readonly status: "rejected";
      readonly category: "window_closed" | "undeliverable" | "template_unavailable" | "provider_authentication" | "provider_rejected";
    }
  | { readonly status: "unavailable" }
  | { readonly status: "uncertain" };

// The Meta error code a failed send carries, wherever the SDK put it: its
// context, its message or its cause. Photon's gRPC errors relay Meta's code in
// their details; which field holds it is checked on a real failure at the join.
export function metaErrorCode(error: unknown): number | null {
  const seen = new Set<unknown>();
  const texts: string[] = [];

  for (let current = error; current && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const value = current as { code?: unknown; message?: unknown; context?: unknown; details?: unknown };
    if (typeof value.code === "number") texts.push(String(value.code));
    for (const part of [value.message, value.details]) if (typeof part === "string") texts.push(part);
    if (value.context && typeof value.context === "object") texts.push(...Object.values(value.context as Record<string, unknown>).map(String));
  }

  for (const text of texts) {
    const match = /\b(13[0-2]\d{3})\b/.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

const BUSINESS_ACCOUNT_REFUSALS = new Set([131031, 131037, 131042, 131045]);

// A failure once the send began: Meta's refusals are final, its rate limits
// mean nothing was sent, and anything else may have gone out.
export function whatsAppSendFailure(error: unknown): WhatsAppSendFailure {
  const code = metaErrorCode(error);
  if (code === 131047) return { category: "window_closed", status: "rejected" };
  if (code === 131026) return { category: "undeliverable", status: "rejected" };
  if (code !== null && code >= 132000 && code <= 132999) return { category: "template_unavailable", status: "rejected" };
  if (code === 130429 || code === 131056) return { status: "unavailable" };
  // The business account cannot send at all until an operator acts in WhatsApp
  // Manager: the account is locked (131031), the display name awaits approval
  // (131037), payment failed (131042) or the certificate is wrong (131045).
  if (code !== null && BUSINESS_ACCOUNT_REFUSALS.has(code)) return { category: "provider_rejected", status: "rejected" };

  const name = (error as { name?: unknown } | null)?.name;
  if (name === "RateLimitError") return { status: "unavailable" };
  if (name === "AuthenticationError") return { category: "provider_authentication", status: "rejected" };
  return { status: "uncertain" };
}
