import { randomBytes } from "node:crypto";
import { parseCookieHeader } from "@supabase/ssr";
import { type ImessageStartStatus, linkMessage, maskSender } from "../contracts/imessage";
import { CommandError } from "./commands";
import type { Database, Queryable } from "./database";
import { generateLinkCode, hashLinkCode } from "./email-links";
import { readReceivedContinuation } from "./imessage-continuation";
import { codeContext, endOpenAttempts, IMESSAGE_LINK_LIMITS, linkLockKey, lockHostLinking, senderContext } from "./imessage-links";
import { imessageHash } from "./photon-receiver";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// The iMessage start on the public page (host-imessage-channel D15): a visitor
// who is not signed in gets the same one-time FMAT- code and Messages deep link as
// the card, so the first message is theirs. The attempt has no host: it belongs
// to this browser through an HttpOnly cookie whose value only this browser holds
// (the database keeps its keyed hash), and the receipt job records the sender as
// for any attempt. Signing in with Google in the same browser gives the open
// attempt to the host (claimStartedLink); Confirm and link on /app binds it, so
// nothing is bound before an authenticated browser saw the masked sender.

export const START_COOKIE = "fmat_imessage_start";
const START_COOKIE_SECONDS = 30 * 60;

export const IMESSAGE_START_LIMITS = {
  // Starts per source address, and across the service, per rolling hour.
  perSourceHour: 5,
  serviceHour: 100,
} as const;

export type StartOptions = {
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly lineNumber: string;
  readonly limits?: Partial<typeof IMESSAGE_START_LIMITS>;
};

export function startCookie(value: string, origin: string, maxAge: number) {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${START_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

// The browser's cookie for a start, keeping the secret it already holds, renewed.
export function startCookieFor(origin: string, kept: string | null) {
  const secret = kept ?? randomBytes(32).toString("base64url");
  return { header: startCookie(secret, origin, START_COOKIE_SECONDS), secret };
}

export function clearStartCookie(origin: string) {
  return startCookie("", origin, 0);
}

export function startSecretOf(request: Request) {
  const value = parseCookieHeader(request.headers.get("cookie") ?? "").find((cookie) => cookie.name === START_COOKIE)?.value;
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function starterHash(key: TokenKey, secret: string) {
  return imessageHash(key, "starter", secret);
}

// Creates this browser's attempt, ending its earlier open one. The source and
// service bounds count every start in the last hour, claimed or not.
export async function startImessageLink(db: Database, options: StartOptions, secret: string, source: string) {
  if (!options.lineNumber) throw new CommandError("unavailable_configuration");
  const limits = { ...IMESSAGE_START_LIMITS, ...options.limits };
  const starter = starterHash(options.tokenKey, secret);

  await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`app.imessage_start_source:${source}`}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ host_account_id: null, starter_hash: starter })}, 0))`;

    const [counts] = await tx<{ source: number; service: number }[]>`
      select count(*) filter (where source_hash = ${source})::int as source, count(*)::int as service
      from app.imessage_links where source_hash is not null and created_at > now() - interval '1 hour'
    `;
    if (counts!.source >= limits.perSourceHour || counts!.service >= limits.serviceHour) throw new CommandError("rate_limited");

    await tx`
      update app.imessage_links
      set state = 'voided', ended_at = now(), code_ciphertext = null, sender_ciphertext = null, space_ciphertext = null
      where starter_hash = ${starter} and host_account_id is null and state in ('pending', 'received')
    `;

    const code = generateLinkCode();
    const [row] = await tx<{ id: string }[]>`select gen_random_uuid() as id`;
    const sealed = sealToken(options.tokenKey, code, codeContext(row!.id));
    await tx`
      insert into app.imessage_links (id, method, starter_hash, source_hash, code_hash, code_ciphertext, sealed_key_id, expires_at)
      values (${row!.id}, 'code', ${starter}, ${source}, ${hashLinkCode(code)}, ${sealed.ciphertext}, ${sealed.keyId},
              now() + make_interval(mins => ${IMESSAGE_LINK_LIMITS.validMinutes}))
    `;
  });
}

// What this browser's open attempt shows: the code to send, or the masked sender.
export async function readStartStatus(db: Queryable, options: StartOptions, secret: string | null): Promise<ImessageStartStatus> {
  const { lineNumber } = options;
  if (!lineNumber) return { state: "unavailable" };
  if (!secret) return { lineNumber, state: "none" };

  const [link] = await db<
    {
      id: string;
      state: "pending" | "received";
      code_ciphertext: string | null;
      sealed_key_id: string | null;
      sender_ciphertext: string | null;
      sender_key_id: string | null;
      expires_at: Date;
      confirm_by: Date | null;
    }[]
  >`
    select id, state, code_ciphertext, sealed_key_id, sender_ciphertext, sender_key_id, expires_at, confirm_by
    from app.imessage_links
    where starter_hash = ${starterHash(options.tokenKey, secret)} and host_account_id is null
      and ((state = 'pending' and expires_at > now()) or (state = 'received' and confirm_by > now()))
  `;
  if (!link) return { lineNumber, state: "none" };

  try {
    if (link.state === "received") {
      const sender = openToken(options.tokenKeys, { ciphertext: link.sender_ciphertext!, keyId: link.sender_key_id! }, senderContext(link.id));
      return { confirmBy: link.confirm_by!.toISOString(), lineNumber, sender: maskSender(sender), state: "received" };
    }
    const code = openToken(options.tokenKeys, { ciphertext: link.code_ciphertext!, keyId: link.sealed_key_id! }, codeContext(link.id));
    return { code, expiresAt: link.expires_at.toISOString(), lineNumber, message: linkMessage(code), state: "pending" };
  } catch {
    // Sealed under a key the service no longer holds: start again.
    return { lineNumber, state: "none" };
  }
}

// The sign-in callback's side: gives this browser's open attempt to the host who
// just signed in, ending the host's own open attempt. A received attempt gets a
// fresh confirmation window, since signing in took part of the first. Returns
// whether an attempt was claimed; a host who is not active claims nothing.
export async function claimStartedLink(db: Database, tokenKey: TokenKey, hostAccountId: string, secret: string) {
  const starter = starterHash(tokenKey, secret);

  return (await db.begin(async (tx) => {
    try {
      await lockHostLinking(tx, hostAccountId);
    } catch (error) {
      if (error instanceof CommandError) return false;
      throw error;
    }
    await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey({ host_account_id: null, starter_hash: starter })}, 0))`;

    const [link] = await tx<{ id: string }[]>`
      select id from app.imessage_links
      where starter_hash = ${starter} and host_account_id is null
        and ((state = 'pending' and expires_at > now()) or (state = 'received' and confirm_by > now()))
      for update
    `;
    if (!link) return false;

    await endOpenAttempts(tx, hostAccountId, "voided");
    await tx`
      update app.imessage_links
      set host_account_id = ${hostAccountId},
          confirm_by = case when state = 'received' then now() + make_interval(mins => ${IMESSAGE_LINK_LIMITS.confirmMinutes}) end
      where id = ${link.id}
    `;
    return true;
  })) as boolean;
}

// The Google callback's side of the sign-in link in Thyme's reply (D19): the
// attempt it names moves to the signed-in host, as claimStartedLink does for
// this browser's attempt, unless another host already holds it. The host has
// the confirmation window again from now. Another browser's starter cookie for
// the same attempt then finds it owned and claims nothing.
export async function claimContinuedLink(db: Database, tokenKey: TokenKey, hostAccountId: string, token: string) {
  return (await db.begin(async (tx) => {
    try {
      await lockHostLinking(tx, hostAccountId);
    } catch (error) {
      if (error instanceof CommandError) return false;
      throw error;
    }
    const named = await readReceivedContinuation(tx, tokenKey, token);
    if (!named || (named.host_account_id !== null && named.host_account_id !== hostAccountId)) return false;
    await tx`select pg_advisory_xact_lock(hashtextextended(${linkLockKey(named)}, 0))`;

    // Read again under the attempt's lock: a code arriving or a confirmation may have changed it.
    const link = await readReceivedContinuation(tx, tokenKey, token);
    if (!link || (link.host_account_id !== null && link.host_account_id !== hostAccountId)) return false;

    if (link.host_account_id === null) await endOpenAttempts(tx, hostAccountId, "voided");
    await tx`
      update app.imessage_links
      set host_account_id = ${hostAccountId}, confirm_by = now() + make_interval(mins => ${IMESSAGE_LINK_LIMITS.confirmMinutes})
      where id = ${link.id}
    `;
    return true;
  })) as boolean;
}
