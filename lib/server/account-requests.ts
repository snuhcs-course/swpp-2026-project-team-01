import type { ConfirmedSettings } from "../contracts/setup";
import { type CommandContext, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { createIdentifiedAgentRequest, type CreateRequestInput } from "./agent-requests";
import { settleCalendarStep } from "./request-start";

// A request a host account sends to another host from the account's own
// connection: the account MCP or the host's linked messenger
// (account-request-identity, testing baseline R01 M-2, P-2 and P-3). The
// requester is the account itself, so nothing about who they are is asked:
//   - the name is the host display name (settings, else the account), and the
//     email is the address Google verified at sign-in, stored as the confirmed
//     contact, as **Continue as {name}** does on the web (host-as-guest-session D1);
//   - the timezone defaults to the account's host timezone;
//   - the account's host conflict calendars count as the requester's busy time
//     by default (the host-profile Calendars item, decided at creation), and the
//     Calendar step is settled, so no calendar question is asked;
//   - the request is linked to the account in the same transaction.
// Nothing here reaches the other host: the host projection and host model
// context never read the requester host profile.

export type AccountRequester = {
  readonly hostAccountId: string;
  readonly name: string;
  readonly email: string;
  // The host timezone, or null for an account without confirmed settings.
  readonly timezone: string | null;
  // The names of the host conflict calendars that count for the request; empty
  // without confirmed settings.
  readonly calendars: readonly string[];
  // Whether the account's Google Calendar grant can be read now. When it cannot,
  // the calendars still count: finding times pauses until the account
  // reconnects Calendar, and never assumes free time (R01 M-2).
  readonly calendarReadable: boolean;
};

export async function readAccountRequester(q: Queryable, hostAccountId: string): Promise<AccountRequester | null> {
  const [row] = await q<{ email: string; display_name: string | null; settings: ConfirmedSettings | null; readable: boolean }[]>`
    select g.email, a.display_name, s.settings,
           exists (select 1 from app.provider_grants p where p.host_account_id = a.id and p.invalidated_at is null) as readable
    from app.host_accounts a
    join app.google_identities g on g.host_account_id = a.id
    left join app.host_settings s on s.host_account_id = a.id
    where a.id = ${hostAccountId} and a.status = 'active'
  `;
  if (!row) return null;
  const name = row.settings?.displayName?.trim() || row.display_name?.trim() || row.email.split("@")[0]!;
  return {
    calendarReadable: row.readable,
    calendars: (row.settings?.conflictCalendars ?? []).map((calendar) => calendar.summary),
    email: row.email,
    hostAccountId,
    name,
    timezone: row.settings?.timezone ?? null,
  };
}

export type AccountRequestInput = Omit<CreateRequestInput, "retryKey" | "name" | "email" | "timezone"> & {
  readonly timezone?: string;
};

// Creates the identified request to `targetHostAccountId` for the account and
// links it with the account's calendars. The caller has checked the target is
// another, ready host that accepts requests, and has admitted the creation.
export async function createAccountRequest(
  tx: Transaction,
  deps: { readonly origin: string; readonly tokenKey: Parameters<typeof createIdentifiedAgentRequest>[1]["tokenKey"] },
  account: AccountRequester,
  targetHostAccountId: string,
  sourceHash: string,
  input: AccountRequestInput,
  context: Pick<CommandContext<unknown>, "correlationId" | "retryKey">,
) {
  // Without host settings there is no timezone to assume: the caller asks.
  const timezone = input.timezone ?? account.timezone;
  if (!timezone) throw new CommandError("invalid_input");
  const requestId = await createIdentifiedAgentRequest(
    tx,
    deps,
    targetHostAccountId,
    sourceHash,
    { ...input, accountVerifiedEmail: true, email: account.email, name: account.name, timezone },
    context,
  );
  await linkAccountRequest(tx, requestId, account);
  return requestId;
}

// The account link with the Calendars item decided at creation (decided_at
// equals created_at: requester-host-profiles.ts keeps such an item when the
// host grant fails, so finding times pauses instead of assuming free time), and
// the Calendar step settled. Without conflict calendars there is nothing to use,
// and the request is linked with no items.
export async function linkAccountRequest(tx: Transaction, requestId: string, account: Pick<AccountRequester, "hostAccountId" | "calendars">) {
  const items = account.calendars.length > 0 ? ["calendars"] : [];
  await tx`
    insert into app.requester_host_profiles (request_id, host_account_id, items, created_at, decided_at)
    values (${requestId}, ${account.hostAccountId}, ${items}, now(), now())
  `;
  await settleCalendarStep(tx, requestId);
}

// Shared account association boundary for messenger and MCP sent actions.
// A typed contact address is never proof of ownership. History summaries can
// outlive a link; live requester actions still require this current access.
export async function readAccountSentAccess(q: Queryable, hostAccountId: string, requestId: string): Promise<{ host_account_id: string; closed: boolean; booked: boolean } | null> {
  const [row] = await q<{ host_account_id: string; closed: boolean; booked: boolean }[]>`
    select r.host_account_id,
           (r.closed_at is not null or r.expires_at <= now()) as closed,
           r.state = 'booked' as booked
    from app.requester_host_profiles p
    join app.requests r on r.id = p.request_id
    join app.booking_links l on l.request_id = r.id and l.expires_at > now()
    where p.host_account_id = ${hostAccountId} and r.id = ${requestId} and r.state <> 'draft'
  `;
  return row ?? null;
}
