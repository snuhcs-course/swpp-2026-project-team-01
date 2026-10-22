// The Continue by email card's status (requester-email-channel design 4), as
// GET /api/requests/{bookingId}/email-link answers it.
export type EmailLinkStatus =
  // No product inbox is configured for this deployment.
  | { readonly state: "unavailable" }
  // The contact address is not confirmed yet, so no code can be made.
  | { readonly state: "needs_confirmation"; readonly inbox: string }
  | { readonly state: "none"; readonly inbox: string }
  // A code to send, as shown, from the confirmed address in a new email.
  | { readonly state: "pending"; readonly inbox: string; readonly code: string; readonly expiresAt: string }
  | { readonly state: "linked"; readonly inbox: string; readonly address: string; readonly linkedAt: string };

export const EMAIL_LINK_CREATE_OPERATION = "request.email_link.create";
export const EMAIL_LINK_UNLINK_OPERATION = "request.email_link.unlink";

// The masked form of an address the card shows: the first character of the
// local part, then the domain.
export function maskAddress(address: string) {
  const at = address.lastIndexOf("@");
  return at > 0 ? `${address[0]}•••${address.slice(at)}` : "•••";
}
