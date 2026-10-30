// The booking page's Get updates in iMessage card (guest-flow-completion design
// 1 and 2), as GET /api/requests/{bookingId}/imessage answers it. The card opens
// Messages with guestLinkMessage(code) addressed to the line, with the helpers
// in imessage.ts; a sender is only ever shown masked. Its commands go through
// the requester commands route.

export const REQUESTER_IMESSAGE_OPERATIONS = {
  create: "request.imessage_link.create",
  confirm: "request.imessage_link.confirm",
  unlink: "request.imessage_link.unlink",
} as const;

export type RequesterImessageStatus =
  // No line is configured for this deployment.
  | { readonly state: "unavailable" }
  | { readonly state: "none"; readonly lineNumber: string }
  // A link code to send from the guest's iMessage, as shown.
  | {
      readonly state: "pending";
      readonly lineNumber: string;
      readonly code: string;
      readonly message: string;
      readonly expiresAt: string;
    }
  // The code's message arrived; the guest confirms the masked sender.
  | {
      readonly state: "received";
      readonly lineNumber: string;
      readonly linkId: string;
      readonly sender: string;
      readonly confirmBy: string;
    }
  | { readonly state: "linked"; readonly lineNumber: string; readonly sender: string; readonly linkedAt: string };

export const GUEST_LINK_MESSAGE_PREFIX = "Get Find Me a Time updates:";

export function guestLinkMessage(code: string) {
  return `${GUEST_LINK_MESSAGE_PREFIX} ${code}`;
}
