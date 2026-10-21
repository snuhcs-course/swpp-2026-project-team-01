import { createHash } from "node:crypto";
import type { Queryable } from "./database";
import { openToken, type SealedToken, sealToken, type TokenKey } from "./token-encryption";

// The booking link (design decisions 2 and 7): a random UUID that is the
// requester's only credential. Lookup always uses its SHA-256; the UUID itself is
// kept sealed under the token key (context booking_link:{requestId}) and opened
// only to email the link to the request's contact or to finish the requester's
// Google return. This is the minimal surface the email and resend paths need;
// request creation and the booking page build on it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBookingId(value: string) {
  return UUID.test(value);
}

export function hashBookingId(bookingId: string) {
  return createHash("sha256").update(bookingId.toLowerCase(), "utf8").digest("hex");
}

export function bookingLinkContext(requestId: string) {
  return `booking_link:${requestId}`;
}

export function sealBookingLink(key: TokenKey, requestId: string, bookingId: string): SealedToken {
  return sealToken(key, bookingId.toLowerCase(), bookingLinkContext(requestId));
}

export type StoredBookingLink = {
  readonly request_id: string;
  readonly link_ciphertext: string;
  readonly link_key_id: string;
};

export function openBookingLink(keys: readonly TokenKey[], link: StoredBookingLink) {
  return openToken(keys, { ciphertext: link.link_ciphertext, keyId: link.link_key_id }, bookingLinkContext(link.request_id));
}

export function bookingUrl(origin: string, bookingId: string) {
  return `${origin.replace(/\/+$/, "")}/booking/${bookingId}`;
}

export type BookingLinkMatch = {
  readonly requestId: string;
  readonly expiresAt: Date;
  readonly expired: boolean;
};

// The request a booking identifier names, by hash only. A malformed identifier
// matches nothing without a query. Expired links are returned as expired so the
// caller can answer with the same generic unavailable view.
export async function findRequestByBookingId(db: Queryable, bookingId: string): Promise<BookingLinkMatch | null> {
  if (!isBookingId(bookingId)) return null;

  const [row] = await db<{ expired: boolean; expires_at: Date; request_id: string }[]>`
    select request_id, expires_at, expires_at <= now() as expired
    from app.booking_links
    where link_hash = ${hashBookingId(bookingId)}
  `;

  return row ? { expired: row.expired, expiresAt: row.expires_at, requestId: row.request_id } : null;
}
