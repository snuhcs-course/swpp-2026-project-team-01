// The booking page's Get updates in iMessage card (guest-flow-completion design
// 1 and 2), as GET /api/requests/{bookingId}/imessage answers it. The card opens
// Messages with guestLinkMessage(code) addressed to the line, with the helpers
// in imessage.ts; a sender is only ever shown masked. Its commands go through
// the requester commands route.
// The card links WhatsApp too (guest-whatsapp-link design 2): "none" names each
// configured channel's number, and a code, sender or binding names its channel.
// A WhatsApp code opens wa.me with the same message (messaging-channel.ts).

export type GuestChannel = "imessage" | "whatsapp";

export const REQUESTER_IMESSAGE_OPERATIONS = {
  create: "request.imessage_link.create",
  confirm: "request.imessage_link.confirm",
  unlink: "request.imessage_link.unlink",
  shareContactCard: "request.imessage_contact_card.share",
} as const;

export type RequesterImessageStatus =
  // No line is configured for this deployment.
  | { readonly state: "unavailable" }
  // lineNumber is the iMessage line ("" without one); whatsappNumber the WhatsApp digits, or null.
  | { readonly state: "none"; readonly lineNumber: string; readonly whatsappNumber: string | null }
  // A link code to send from the guest's iMessage or WhatsApp, as shown, to lineNumber.
  | {
      readonly state: "pending";
      readonly channel: GuestChannel;
      readonly lineNumber: string;
      readonly code: string;
      readonly message: string;
      readonly expiresAt: string;
    }
  // The code's message arrived; the guest confirms the masked sender.
  | {
      readonly state: "received";
      readonly channel: GuestChannel;
      readonly lineNumber: string;
      readonly linkId: string;
      readonly sender: string;
      readonly confirmBy: string;
    }
  | { readonly state: "linked"; readonly channel: GuestChannel; readonly lineNumber: string; readonly sender: string; readonly linkedAt: string; readonly contactCard: { readonly state: "queued" | "sent" | "failed" | "uncertain" } | null };

export const GUEST_LINK_MESSAGE_PREFIX = "Get Find Me a Time updates:";

export function guestLinkMessage(code: string) {
  return `${GUEST_LINK_MESSAGE_PREFIX} ${code}`;
}
