import type { ConfirmedSettings } from "../contracts/setup";
import type { CommandContext } from "./commands";
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
};

export async function readAccountRequester(q: Queryable, hostAccountId: string): Promise<AccountRequester | null> {
  const [row] = await q<{ email: string; display_name: string | null; settings: ConfirmedSettings | null }[]>`
    select g.email, a.display_name, s.settings
    from app.host_accounts a
    join app.google_identities g on g.host_account_id = a.id
    left join app.host_settings s on s.host_account_id = a.id
    where a.id = ${hostAccountId} and a.status = 'active'
  `;
  if (!row) return null;
  const name = row.settings?.displayName?.trim() || row.display_name?.trim() || row.email.split("@")[0]!;
  return {
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
  const timezone = input.timezone ?? account.timezone ?? "UTC";
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

// The account link with the Calendars item decided, and the Calendar step
// settled. Without confirmed settings there are no host calendars to use, and
// the request is linked with no items.
export async function linkAccountRequest(tx: Transaction, requestId: string, account: Pick<AccountRequester, "hostAccountId" | "timezone">) {
  const items = account.timezone === null ? [] : ["calendars"];
  await tx`
    insert into app.requester_host_profiles (request_id, host_account_id, items, decided_at)
    values (${requestId}, ${account.hostAccountId}, ${items}, now())
  `;
  await settleCalendarStep(tx, requestId);
}
