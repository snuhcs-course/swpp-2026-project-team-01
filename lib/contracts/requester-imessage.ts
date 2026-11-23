// The booking page's Get updates in iMessage card (guest-flow-completion design
// 1 and 2), as GET /api/requests/{bookingId}/imessage answers it. The card opens
// Messages with guestLinkMessage(code) addressed to the line, with the helpers
// in imessage.ts; a sender is only ever shown masked. Its commands go through
// the requester commands route.
// The card links WhatsApp too (guest-whatsapp-link design 2): "none" names each
// configured channel's number, and a code, sender or binding names its channel.
// A WhatsApp code opens wa.me with the same message (messaging-channel.ts).
// The card links Telegram too (guest-telegram-link design 2): "none" names the
// bot's username, and a Telegram code carries the bot as lineNumber and the
// bare code as message, so telegramLinkFor(lineNumber, message) is the start link.
// The code links as soon as it arrives (link-on-code D1): "pending" goes straight
// to "linked", whose sender is masked (maskedSender) or the Telegram name.

export type GuestChannel = "imessage" | "whatsapp" | "telegram";

export const GUEST_CHANNELS = ["imessage", "whatsapp", "telegram"] as const satisfies readonly GuestChannel[];

export const REQUESTER_IMESSAGE_OPERATIONS = {
  emailOnly: "request.notifications.email_only",
  create: "request.imessage_link.create",
  unlink: "request.imessage_link.unlink",
  shareContactCard: "request.imessage_contact_card.share",
} as const;

export type RequesterImessageStatus =
  // No channel is configured for this deployment.
  | { readonly state: "unavailable" }
  // lineNumber is the iMessage line ("" without one); whatsappNumber the WhatsApp
  // digits, and telegramUsername the bot's username, each null without one.
  | { readonly state: "none"; readonly lineNumber: string; readonly whatsappNumber: string | null; readonly telegramUsername: string | null; readonly emailOnly?: boolean }
  // A link code to send from the guest's iMessage or WhatsApp, as shown, to
  // lineNumber; on Telegram, the bot's start link carries the code.
  | {
      readonly state: "pending";
      readonly channel: GuestChannel;
      readonly lineNumber: string;
      readonly code: string;
      readonly message: string;
      readonly expiresAt: string;
    }
  | { readonly state: "linked"; readonly channel: GuestChannel; readonly lineNumber: string; readonly sender: string; readonly linkedAt: string; readonly contactCard: { readonly state: "queued" | "sent" | "failed" | "uncertain" } | null };

export const GUEST_LINK_MESSAGE_PREFIX = "Get Find Me a Time updates:";

export function guestLinkMessage(code: string) {
  return `${GUEST_LINK_MESSAGE_PREFIX} ${code}`;
}
