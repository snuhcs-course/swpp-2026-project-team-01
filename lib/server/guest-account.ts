import { z } from "zod";
import { ACTIONABLE_REQUEST_STATES, REQUEST_LANGUAGES } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import { openBookingLink } from "./booking-links";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable } from "./database";
import { lockOpenRequest } from "./request-guard";
import { type IdentifyOptions, type IdentifyResult, identifyDraft, settleCalendarStep } from "./request-start";
import { recordHostSessionMatch } from "./requester-host-profiles";
import type { TokenKey } from "./token-encryption";

// A signed-in account as a guest on another host's booking link
// (host-as-guest-session, #183). The account's session never becomes a guest
// credential: the booking identifier stays the request's only one. The session
// only lets the account identify a draft it holds the link for with its own
// name and Google-verified address, and lets the pages recognize the account
// to offer its open request and the way back to /app.

export const IDENTIFY_ACCOUNT_OPERATION = "request.identify_account";

export type GuestAccount = {
  readonly hostAccountId: string;
  readonly name: string;
  readonly email: string;
};

// The signed-in account's name and the address Google verified when it signed
// in, for an active account only.
export async function readGuestAccount(db: Queryable, authUserId: string): Promise<GuestAccount | null> {
  const [row] = await db<{ host_account_id: string; name: string | null; email: string }[]>`
    select a.id as host_account_id, g.email,
           coalesce(nullif(s.settings ->> 'displayName', ''), a.display_name) as name
    from app.google_identities g
    join app.host_accounts a on a.id = g.host_account_id and a.status = 'active'
    left join app.host_settings s on s.host_account_id = a.id
    where g.auth_user_id = ${authUserId}
  `;
  if (!row) return null;
  return { email: row.email, hostAccountId: row.host_account_id, name: row.name?.trim() || row.email.split("@")[0]! };
}

export type BookingLinkVisitor = {
  readonly name: string;
  readonly ownLink: boolean;
  // The account's newest open request with this host, by its private link.
  readonly openRequestPath: string | null;
};

// What the booking link of `linkHostAccountId` shows a signed-in account. Only
// requests already linked to the account are considered, never one matched by
// a contact address.
export async function readBookingLinkVisitor(
  db: Queryable,
  authUserId: string,
  linkHostAccountId: string,
  tokenKeys: readonly TokenKey[],
): Promise<BookingLinkVisitor | null> {
  const account = await readGuestAccount(db, authUserId);
  if (!account) return null;
  if (account.hostAccountId === linkHostAccountId) return { name: account.name, openRequestPath: null, ownLink: true };

  const [link] = await db<{ request_id: string; link_ciphertext: string; link_key_id: string }[]>`
    select l.request_id, l.link_ciphertext, l.link_key_id
    from app.requester_host_profiles p
    join app.requests r on r.id = p.request_id
    join app.booking_links l on l.request_id = r.id
    where p.host_account_id = ${account.hostAccountId}
      and r.host_account_id = ${linkHostAccountId}
      and r.state::text = any(${[...ACTIONABLE_REQUEST_STATES]}::text[])
      and l.expires_at > now()
    order by r.updated_at desc
    limit 1
  `;
  let openRequestPath: string | null = null;
  if (link) {
    try {
      openRequestPath = `/booking/${openBookingLink(tokenKeys, link)}`;
    } catch {
      openRequestPath = null;
    }
  }
  return { name: account.name, openRequestPath, ownLink: false };
}

// Whether the guest request is linked to the signed-in account, for the guest
// page's way back to /app. It reveals nothing else.
export async function isRequestLinkedToAccount(db: Queryable, authUserId: string, requestId: string) {
  const [row] = await db<{ linked: boolean }[]>`
    select true as linked
    from app.requester_host_profiles p
    join app.google_identities g on g.host_account_id = p.host_account_id and g.auth_user_id = ${authUserId}
    join app.host_accounts a on a.id = p.host_account_id and a.status = 'active'
    where p.request_id = ${requestId}
  `;
  return Boolean(row?.linked);
}

export const identifyAccountInput = z
  .object({
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Not a timezone."),
    language: z.enum(REQUEST_LANGUAGES).optional(),
  })
  .strict();

export type IdentifyAccountInput = z.infer<typeof identifyAccountInput>;

// request.identify_account: **Continue as {name}**. The route builds it only
// for a verified session; the account must be active and must not be the
// request's host. Like **Continue without Google**, the Calendar step is
// settled as skipped; the host settings card can then offer the account's own
// calendars.
export function identifyAccountCommand(
  options: IdentifyOptions & { readonly authUserId: string },
): CommandDefinition<IdentifyAccountInput, IdentifyResult> {
  return {
    input: identifyAccountInput,
    operation: IDENTIFY_ACCOUNT_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
        throw new CommandError("forbidden");
      }

      const request = await lockOpenRequest(tx, context.actor.id);
      const account = await readGuestAccount(tx, options.authUserId);
      if (!account || account.hostAccountId === request.host_account_id) throw new CommandError("forbidden");

      const result = await identifyDraft(
        tx,
        request,
        { ...context.input, accountVerifiedEmail: true, email: account.email, name: account.name },
        options,
      );
      await settleCalendarStep(tx, request.id);
      await recordHostSessionMatch(tx, request.id, options.authUserId);
      return result;
    },
  };
}
