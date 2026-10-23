import { createHmac, timingSafeEqual } from "node:crypto";
import { parseCookieHeader } from "@supabase/ssr";
import type { Queryable } from "./database";
import type { TokenKey } from "./token-encryption";

// The sign-in link in Thyme's reply to a code from the iMessage start
// (host-imessage-channel D19), so the sender can sign in from the thread, in
// whatever browser the link opens. It goes only to the sender's direct
// conversation, as {attempt id}.{HMAC of the id and the sender's hash}, and works
// only while that attempt is received and before its confirmation deadline. It
// signs nobody in: Google sign-in and Confirm and link are still required, and a
// confirmed, cancelled or expired attempt ends it.
export const CONTINUATION_COOKIE = "fmat_imessage_continue";
export const CONTINUATION_SECONDS = 15 * 60;

function proof(key: TokenKey, id: string, senderHash: string) {
  return createHmac("sha256", key.key).update(`find-me-a-time/imessage-continue/v1:${id}:${senderHash}`).digest("hex");
}

export function imessageContinuationUrl(origin: string, key: TokenKey, id: string, senderHash: string) {
  return `${origin}/imessage/continue?token=${id}.${proof(key, id, senderHash)}`;
}

export function continuationCookie(value: string, origin: string, maxAge: number) {
  return `${CONTINUATION_COOKIE}=${value}; Path=/auth; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${origin.startsWith("https:") ? "; Secure" : ""}`;
}

export function continuationOf(request: Request) {
  return parseCookieHeader(request.headers.get("cookie") ?? "").find((cookie) => cookie.name === CONTINUATION_COOKIE)?.value ?? null;
}

export async function readReceivedContinuation(db: Queryable, key: TokenKey, token: string) {
  const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const [link] = await db<{ id: string; host_account_id: string | null; starter_hash: string | null; sender_hash: string }[]>`
    select id, host_account_id, starter_hash, sender_hash from app.imessage_links
    where id = ${match[1]!} and state = 'received' and confirm_by > now() and sender_hash is not null
  `;
  if (!link || !timingSafeEqual(Buffer.from(match[2]!, "hex"), Buffer.from(proof(key, link.id, link.sender_hash), "hex"))) return null;
  return link;
}
