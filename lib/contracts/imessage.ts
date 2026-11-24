// The Connect iMessage card's contract (host-imessage-channel design 4 to 6 and
// 11), as GET /api/host/imessage answers it, and the browser-safe helpers the
// card uses to open Messages (D4). Nothing here ever carries a fallback code the
// service sent, and a sender is only ever shown masked.
// The same card links WhatsApp (host-whatsapp-channel design 6): every state
// names the numbers this deployment can link (channels), and an attempt or a
// binding names its channel; lineNumber is that channel's number (digits for
// WhatsApp), or the iMessage line in "none".
// A code links as soon as its message arrives (link-on-code D1): the card goes
// from "pending" to "linked" with no confirmation step, and a linked sender is
// shown by its last four digits, its email or its Telegram name (maskedSender).
// It links Telegram too (host-telegram-channel design 6): channels.telegram is
// the bot's username; a Telegram attempt's lineNumber is that username and its
// message the bare code, which the card turns into the telegram.me start link; a
// Telegram sender is shown by name ("Dohyeon (@dohyeon)"), never by user ID.

import type { ConfiguredChannels, MessagingChannel } from "./messaging-channel";

// What a host can link to, null where a channel is not configured.
export type LinkChannels = ConfiguredChannels;

export const IMESSAGE_OPERATIONS = [
  "imessage.link.create",
  "imessage.link.cancel",
  "imessage.link.send_code",
  "imessage.link.verify_code",
  "imessage.unlink",
  "imessage.contact_card.share",
] as const;

export type ImessageOperation = (typeof IMESSAGE_OPERATIONS)[number];

export type ImessageDeliveryState = "queued" | "sent" | "failed" | "uncertain";

export type ImessageDelivery = {
  readonly state: "failed" | "uncertain";
  readonly at: string;
  // Why a WhatsApp message was not sent (host-whatsapp-channel design 7 and 8):
  // the host had not written for a day, or Meta refused the notice's template.
  readonly reason: "window_closed" | "template_unavailable" | null;
};

export type ImessageStatus =
  // No line is configured for this deployment.
  | { readonly state: "unavailable" }
  | { readonly state: "none"; readonly lineNumber: string; readonly channels: LinkChannels }
  // A link code to send from the host's iMessage or WhatsApp, as shown.
  | {
      readonly state: "pending";
      readonly channel: MessagingChannel;
      readonly channels: LinkChannels;
      readonly lineNumber: string;
      readonly code: string;
      readonly message: string;
      readonly expiresAt: string;
    }
  // The fallback: a code sent to the entered number, typed back here.
  | {
      readonly state: "fallback";
      readonly channel: "imessage";
      readonly channels: LinkChannels;
      readonly lineNumber: string;
      readonly number: string;
      readonly send: ImessageDeliveryState;
      readonly expiresAt: string | null;
      readonly resendAt: string | null;
      readonly sendsLeft: number;
    }
  | {
      readonly state: "linked";
      readonly channel: MessagingChannel;
      readonly channels: LinkChannels;
      readonly lineNumber: string;
      readonly sender: string;
      readonly linkedAt: string;
      // The latest message to the linked conversation that failed or may not have arrived.
      readonly delivery: ImessageDelivery | null;
      readonly contactCard: { readonly state: ImessageDeliveryState } | null;
    };

// The iMessage start on the public page (D15), as GET /api/imessage/start
// answers it for this browser before sign-in: the same code and message as the
// card, then the masked sender once it arrived. Signing in with Google in this
// browser binds that sender to the host who signed in (link-on-code D3).
export type ImessageStartStatus =
  | { readonly state: "unavailable" }
  | { readonly state: "none"; readonly lineNumber: string; readonly channels: LinkChannels }
  | {
      readonly state: "pending";
      readonly channel: MessagingChannel;
      readonly channels: LinkChannels;
      readonly lineNumber: string;
      readonly code: string;
      readonly message: string;
      readonly expiresAt: string;
    }
  | {
      readonly state: "received";
      readonly channel: MessagingChannel;
      readonly channels: LinkChannels;
      readonly lineNumber: string;
      readonly sender: string;
      readonly confirmBy: string;
    };

export const LINK_MESSAGE_PREFIX = "Link my Find Me a Time account:";

export function linkMessage(code: string) {
  return `${LINK_MESSAGE_PREFIX} ${code}`;
}

// A sender in full: an E.164 number as it is, a WhatsApp contact ID (digits
// without "+") with its plus, or the whole Apple ID email.
export function displaySender(sender: string) {
  return /^\d+$/.test(sender) ? `+${sender}` : sender;
}

// A linked sender as the screens show it (link-on-code D4): a number by its last
// four digits ("•••• 5678"), an Apple ID email as the handle it is. Enough for
// the person to recognize their own number and press Not my number, without
// showing the whole number on every screen.
export function maskedSender(sender: string) {
  const shown = displaySender(sender);
  if (!/^\+\d+$/.test(shown)) return shown;
  return `•••• ${shown.slice(-4)}`;
}

export type MessagesPlatform = "ios" | "android" | "mac" | "other";

// Where the Messages app can be opened with a prefilled body: iPhone, iPad and
// iPod, an iPad that reports a Macintosh user agent (it has touch points), and
// Android. A Mac (a Macintosh user agent without touch points) has Messages too,
// which the link screens offer beside the QR code and Copy (D17); everything
// else gets only those two.
export function messagesPlatform(userAgent: string, maxTouchPoints = 0): MessagesPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent)) return maxTouchPoints > 1 ? "ios" : "mac";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

// The sms: deep link for a platform: `&body=` on iOS and a Mac, `?body=` on
// Android. Whether a Mac's Messages takes the body is not verified on a device.
export function deepLinkFor(platform: MessagesPlatform, number: string, text: string) {
  const body = encodeURIComponent(text);
  if (platform === "ios" || platform === "mac") return `sms:${number}&body=${body}`;
  if (platform === "android") return `sms:${number}?body=${body}`;
  return null;
}

// The deep link a QR code carries: the iOS form, since the MVP targets iPhone hosts.
export function qrDeepLink(number: string, text: string) {
  return deepLinkFor("ios", number, text)!;
}

export const E164_NUMBER = /^\+[1-9]\d{6,14}$/;

// An entered number in E.164, with spaces, dashes, dots and parentheses removed.
export function normalizeNumber(value: string) {
  const compact = value.replace(/[\s().-]/g, "");
  return E164_NUMBER.test(compact) ? compact : null;
}
