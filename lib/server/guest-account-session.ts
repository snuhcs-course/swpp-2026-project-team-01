import { database } from "./database";
import { type BookingLinkVisitor, isRequestLinkedToAccount, readBookingLinkVisitor } from "./guest-account";
import { supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";
import { tokenKeyFromEnvironment } from "./token-encryption";

// The guest pages' view of the browser's account session (host-as-guest-session).
// It only changes what the pages offer; a missing or unreadable session leaves
// them exactly as for any guest.

type CookieJar = { getAll(): readonly { readonly name: string; readonly value: string }[] };

async function sessionUserId(jar: CookieJar) {
  const cookie = jar
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  if (!cookie) return null;
  return verifiedUserId(new Request("http://localhost/", { headers: { cookie } }), supabaseAuthConfigFromEnvironment());
}

function logUnavailable(error: unknown) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.name : typeof error, event: "guest_account_session_unavailable" }));
}

// The booking link of `hostAccountId`, as the signed-in account sees it.
export async function bookingLinkVisitor(jar: CookieJar, hostAccountId: string): Promise<BookingLinkVisitor | null> {
  try {
    const userId = await sessionUserId(jar);
    return userId ? await readBookingLinkVisitor(database(), userId, hostAccountId, [tokenKeyFromEnvironment()]) : null;
  } catch (error) {
    logUnavailable(error);
    return null;
  }
}

// Whether the guest request is linked to the signed-in account.
export async function signedInGuestAccount(jar: CookieJar, { requestId }: { readonly requestId: string }) {
  try {
    const userId = await sessionUserId(jar);
    return userId ? { linked: await isRequestLinkedToAccount(database(), userId, requestId) } : null;
  } catch (error) {
    logUnavailable(error);
    return null;
  }
}
