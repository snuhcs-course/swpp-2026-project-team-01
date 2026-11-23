import { z } from "zod";
import { REQUESTER_TRAVEL_MODES, type ReviewPatch } from "../contracts/request";
import { HOST_PROFILE_ITEMS, type HostProfileItem, type RequesterHostProfileView } from "../contracts/requester-view";
import type { ConfirmedSettings } from "../contracts/setup";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { bindHostConversation } from "./host-conversation-bindings";
import { assertIdentified, type LockedRequest, lockOpenRequest } from "./request-guard";
import { endRequesterBindings } from "./requester-imessage-bindings";
import type { TokenKey } from "./token-encryption";

// A guest who is a host (guest-flow-completion design 6, D7 and D8). On the
// requester Google return, the verified Google subject is compared with host
// accounts' Google identities; an active account that is not the request's
// host is recorded. Only an account with confirmed settings gets **Use your
// host settings for this request**. Nothing is used before the guest decides, and
// the choice lives with the request until it closes, while the verified match
// remains for the signed-in account's request history. Nothing here reaches the
// request's host: the host projection and host model context never read it.

// Records the match for a request on its Google return. The card is offered
// once: a later return keeps the earlier record and its decision.
export async function recordHostProfileMatch(tx: Transaction, requestId: string, googleSubject: string) {
  await tx`
    insert into app.requester_host_profiles (request_id, host_account_id)
    select r.id, g.host_account_id
    from app.requests r
    join app.google_identities g on g.google_subject = ${googleSubject}
    join app.host_accounts a on a.id = g.host_account_id and a.status = 'active'
    where r.id = ${requestId} and g.host_account_id <> r.host_account_id
    on conflict (request_id) do nothing
  `;
}

// Manual guest identification may still carry an already signed-in account
// session. Link that account after request.identify succeeds; the session's
// verified Auth user ID, never the typed contact email, supplies authority.
export async function recordHostSessionMatch(tx: Transaction, requestId: string, authUserId: string) {
  await tx`
    insert into app.requester_host_profiles (request_id, host_account_id)
    select r.id, g.host_account_id
    from app.requests r
    join app.google_identities g on g.auth_user_id = ${authUserId}
    join app.host_accounts a on a.id = g.host_account_id and a.status = 'active'
    where r.id = ${requestId} and r.state <> 'draft' and g.host_account_id <> r.host_account_id
    on conflict (request_id) do nothing
  `;
}

type ProfileRow = { host_account_id: string; items: HostProfileItem[]; decided_at: Date | null };

async function profileOf(q: Queryable, requestId: string, lock = false) {
  const [row] = lock
    ? await q<ProfileRow[]>`
        select p.host_account_id, p.items, p.decided_at
        from app.requester_host_profiles p
        join app.host_settings s on s.host_account_id = p.host_account_id
        where p.request_id = ${requestId} for update of p
      `
    : await q<ProfileRow[]>`
        select p.host_account_id, p.items, p.decided_at
        from app.requester_host_profiles p
        join app.host_settings s on s.host_account_id = p.host_account_id
        where p.request_id = ${requestId}
      `;
  return row ?? null;
}

export async function readHostProfileView(q: Queryable, requestId: string): Promise<RequesterHostProfileView | null> {
  const profile = await profileOf(q, requestId);
  if (!profile) return null;
  return { decided: profile.decided_at !== null, items: profile.items, messenger: await messengerState(q, requestId, profile.host_account_id), offered: HOST_PROFILE_ITEMS };
}

// The guest-host's own host calendars for the requester projection (R01 M-2,
// M-2.1): their names and whether they count for this request. Null for a
// guest who is not a host with confirmed settings. The names are the
// requester's own; nothing here reaches the request's host.
export async function readHostCalendarsView(q: Queryable, requestId: string) {
  const [row] = await q<{ items: HostProfileItem[]; decided: boolean; settings: ConfirmedSettings }[]>`
    select p.items, p.decided_at is not null as decided, s.settings
    from app.requester_host_profiles p
    join app.host_accounts a on a.id = p.host_account_id and a.status = 'active'
    join app.host_settings s on s.host_account_id = p.host_account_id
    where p.request_id = ${requestId}
  `;
  if (!row) return null;
  return {
    calendars: row.settings.conflictCalendars.map((calendar) => calendar.summary),
    counted: row.decided && row.items.includes("calendars"),
  };
}

// Whether the guest-host has a linked host conversation, and whether this
// request is bound to it (#61).
async function messengerState(q: Queryable, requestId: string, hostAccountId: string) {
  const [row] = await q<{ offered: boolean; bound: boolean }[]>`
    select true as offered,
           exists (
             select 1 from app.requester_imessage_bindings rb
             where rb.request_id = ${requestId} and rb.state = 'active' and rb.link_id is null and rb.sender_hash = b.sender_hash
           ) as bound
    from app.imessage_bindings b
    where b.host_account_id = ${hostAccountId} and b.state = 'active'
  `;
  return { offered: Boolean(row?.offered), on: Boolean(row?.bound) };
}

const decideInput = z
  .object({
    items: z.array(z.enum(HOST_PROFILE_ITEMS)).max(HOST_PROFILE_ITEMS.length),
    // Updates in the host conversation (#61); left as it is when omitted.
    messenger: z.boolean().optional(),
  })
  .strict();

// request.host_profile.decide: **Use these settings** with the checked items,
// or **Not now** with none; **Change** on the receipt decides again. Calendars
// settle the Calendar step (the evaluation also counts any calendars connected
// for the request); taking them back reopens it unless such a grant exists. Basic details become a pending
// review the guest applies.
// **Updates in your host conversation** (#61) binds the request's guest
// conversation to the guest-host's linked host conversation, with the Linked
// welcome there; turning it off unlinks that binding. Its notices then select
// it there, and `request <ref>` names it (host-sent-requests.ts).
export function decideHostProfileCommand(
  keys?: { readonly tokenKey: TokenKey; readonly tokenKeys: readonly TokenKey[] },
): CommandDefinition<z.infer<typeof decideInput>, { items: HostProfileItem[]; messenger?: boolean }> {
  return {
    input: decideInput,
    operation: "request.host_profile.decide",
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
      const request = await lockOpenRequest(tx, context.actor.id);
      assertIdentified(request);
      const profile = await profileOf(tx, request.id, true);
      if (!profile) throw new CommandError("invalid_input");

      const items = HOST_PROFILE_ITEMS.filter((item) => context.input.items.includes(item));
      const added = (item: HostProfileItem) => items.includes(item) && !profile.items.includes(item);
      const removed = (item: HostProfileItem) => !items.includes(item) && profile.items.includes(item);

      await tx`
        update app.requester_host_profiles set items = ${items}, decided_at = now() where request_id = ${request.id}
      `;

      const [grant] = await tx<{ id: string }[]>`
        select id from app.requester_grants where request_id = ${request.id} and kind = 'calendar' and revoked_at is null
      `;
      if (added("calendars") && !grant) {
        await tx`update app.requests set calendar_settled_at = coalesce(calendar_settled_at, now()) where id = ${request.id}`;
      }
      if (removed("calendars") && !grant) {
        await tx`update app.requests set calendar_settled_at = null where id = ${request.id}`;
      }

      if (added("details")) await draftHostDetails(tx, request, profile.host_account_id);

      if (context.input.messenger !== undefined && keys) {
        const state = await messengerState(tx, request.id, profile.host_account_id);
        if (context.input.messenger && !state.on) {
          const [host] = await tx<{ name: string }[]>`
            select coalesce(nullif(s.settings ->> 'displayName', ''), h.display_name, 'your host') as name
            from app.host_accounts h left join app.host_settings s on s.host_account_id = h.id
            where h.id = ${request.host_account_id}
          `;
          const bound = await bindHostConversation(tx, keys, {
            hostAccountId: profile.host_account_id, hostName: host?.name ?? "your host", requestId: request.id, select: false, welcome: true,
          });
          if (!bound) throw new CommandError("invalid_input");
        } else if (!context.input.messenger && state.on) {
          await endRequesterBindings(tx, request.id, "unlinked");
        }
        return { items, messenger: context.input.messenger };
      }

      return { items };
    },
  };
}

// Whether the guest-host's host calendars count for this one request, decided
// in words from the conversation or the account connection (R01 M-2.1, #334).
// Only the request's Calendars item changes: the host's own calendar roles
// and settings never do. The item names every host conflict calendar or none;
// leaving out only some of them for one request has nowhere to be recorded
// (requester_host_profiles.items holds the item, not a calendar list), so it is
// not offered. While the web card is undecided, the card decides. The decision
// time is kept, so a request the account sent (decided_at = created_at) keeps
// its no-card handling of a failed grant (dropGuestHostCalendars). A change
// moves the request to a new revision, so earlier times and a proposal found
// with the other choice are no longer current; the assistant finds times again.
export const HOST_CALENDARS_STATES = ["gathering", "negotiating"] as const;

export type HostCalendarsOutcome =
  | { readonly outcome: "used" | "not_used" | "unchanged"; readonly use: boolean; readonly calendars: readonly string[] }
  // No host account is linked to this request, its host settings name no
  // conflict calendar to use, or the web card is still open.
  | { readonly outcome: "not_linked" | "no_host_calendars" | "card_open" }
  // After agreement the request waits for the host or is booked: change_agreement
  // or change_booking reopens it first.
  | { readonly outcome: "not_now"; readonly state: string };

// What the assistant tells the person, by outcome; `find` names the tool that
// finds times again on its surface.
export function hostCalendarsMessage(result: HostCalendarsOutcome, find: string) {
  switch (result.outcome) {
    case "used":
    case "unchanged": {
      const names = result.calendars.join(", ");
      if (!result.use) return `Their host calendars do not count for this request; their host settings are unchanged. Call ${find} for times without them.`;
      return result.outcome === "used"
        ? `Their host calendars (${names}) now count as busy time for this request only; their host settings are unchanged. Call ${find} again, since earlier times did not count them.`
        : `Their host calendars (${names}) already count for this request. Nothing changed.`;
    }
    case "not_used":
      return `Their host calendars no longer count for this request only; their host calendar settings are unchanged. Call ${find} again, since earlier times counted them.`;
    case "not_linked":
      return "This request is not linked to a host account, so there are no host calendars to use or leave out.";
    case "no_host_calendars":
      return "Their host settings name no calendar to check for conflicts, so there is nothing to use.";
    case "card_open":
      return "The Use your host settings for this request card is still open on the page: the person chooses Calendars there. Nothing changed.";
    case "not_now":
      return `The calendars cannot change now (status ${result.state}): they matter only while times are being chosen. Reopen first only if the person wants another time.`;
  }
}

const hostCalendarsInput = z
  .object({
    use: z.boolean().describe("true: the person's host conflict calendars count as their busy time for this request; false: none of them count."),
  })
  .strict();

export const hostCalendarsCommand: CommandDefinition<z.infer<typeof hostCalendarsInput>, HostCalendarsOutcome> = {
  input: hostCalendarsInput,
  operation: "request.host_profile.calendars",
  async run(tx, context) {
    if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");
    const request = await lockOpenRequest(tx, context.actor.id);
    assertIdentified(request);
    const profile = await profileOf(tx, request.id, true);
    if (!profile) return { outcome: "not_linked" };
    if (!(HOST_CALENDARS_STATES as readonly string[]).includes(request.state)) return { outcome: "not_now", state: request.state };

    const [row] = await tx<{ settings: ConfirmedSettings }[]>`
      select settings from app.host_settings where host_account_id = ${profile.host_account_id}
    `;
    const calendars = (row?.settings.conflictCalendars ?? []).map((calendar) => calendar.summary);
    const use = context.input.use;
    if (use && calendars.length === 0) return { outcome: "no_host_calendars" };

    // While the card is still open, the card decides: one sentence about
    // calendars must not answer its other choices too.
    if (profile.decided_at === null) return { outcome: "card_open" };
    const using = profile.items.includes("calendars");
    if (using === use) return { calendars, outcome: "unchanged", use };

    const items = HOST_PROFILE_ITEMS.filter((item) => (item === "calendars" ? use : profile.items.includes(item)));
    await tx`update app.requester_host_profiles set items = ${items} where request_id = ${request.id}`;
    // As the card does, when no calendar was connected for the request: using
    // the calendars settles the Calendar step, and taking them back reopens it
    // on the web. A request the account sent has no Calendar card, so its step
    // stays settled and times are found without busy time from the account.
    const [grant] = await tx<{ id: string }[]>`
      select id from app.requester_grants where request_id = ${request.id} and kind = 'calendar' and revoked_at is null
    `;
    const [linked] = await tx<{ account: boolean }[]>`
      select decided_at = created_at as account from app.requester_host_profiles where request_id = ${request.id}
    `;
    if (use && !grant) {
      await tx`update app.requests set calendar_settled_at = coalesce(calendar_settled_at, now()) where id = ${request.id}`;
    } else if (!use && !grant && !linked?.account) {
      await tx`update app.requests set calendar_settled_at = null where id = ${request.id}`;
    }
    // Times and a proposal found with the earlier choice are no longer
    // current, as after a details change: a new revision, and a request
    // choosing among them returns to gathering.
    await tx`
      update app.requests
      set state = case when state = 'negotiating' then 'gathering' else state end, revision = revision + 1, updated_at = now()
      where id = ${request.id}
    `;
    return { calendars, outcome: use ? "used" : "not_used", use };
  },
};

// Basic details as a pending review (D7: nothing changes without the guest):
// the host timezone and, when it names one way, the host's travel mode.
async function draftHostDetails(
  tx: Transaction,
  request: Pick<LockedRequest, "id" | "revision" | "details">,
  hostAccountId: string,
) {
  const [row] = await tx<{ settings: ConfirmedSettings }[]>`
    select settings from app.host_settings where host_account_id = ${hostAccountId}
  `;
  if (!row) return;

  const travel = (REQUESTER_TRAVEL_MODES as readonly string[]).includes(row.settings.travelMode ?? "")
    ? (row.settings.travelMode as ReviewPatch["travelMode"])
    : undefined;
  const patch: ReviewPatch = {
    ...(row.settings.timezone !== request.details.timezone ? { timezone: row.settings.timezone } : {}),
    ...(travel && travel !== request.details.travelMode ? { travelMode: travel } : {}),
  };
  if (Object.keys(patch).length === 0) return;

  await tx`
    update app.request_reviews set state = 'superseded', resolved_at = now()
    where request_id = ${request.id} and state = 'pending'
  `;
  await tx`
    insert into app.request_reviews (request_id, base_revision, intent, patch, clarifications)
    values (${request.id}, ${request.revision}, 'details', ${tx.json(patch as Parameters<typeof tx.json>[0])}, ${[]})
  `;
}

// What the evaluation reads for a guest who is a host and chose Calendars (D8):
// their host account, its Google address and its conflict calendars. Null
// otherwise.
export type GuestHostSource = {
  readonly hostAccountId: string;
  readonly email: string | null;
  readonly conflictCalendars: ConfirmedSettings["conflictCalendars"];
  // The guest-host's own weekly windows and weekly limit, which order this
  // request's candidates as soft preferences (#60, design 7).
  readonly preferences: Pick<ConfirmedSettings, "timezone" | "weeklyWindows" | "weeklyLimit" | "weeklyLimitCounts" | "location">;
};

export async function readGuestHostSource(q: Queryable, requestId: string): Promise<GuestHostSource | null> {
  const [row] = await q<{ email: string | null; host_account_id: string; settings: ConfirmedSettings }[]>`
    select p.host_account_id, s.settings,
           (select email from app.google_identities g where g.host_account_id = p.host_account_id) as email
    from app.requester_host_profiles p
    join app.host_accounts a on a.id = p.host_account_id and a.status = 'active'
    join app.host_settings s on s.host_account_id = p.host_account_id
    where p.request_id = ${requestId} and p.decided_at is not null and 'calendars' = any(p.items)
  `;
  return row
    ? {
        conflictCalendars: row.settings.conflictCalendars,
        email: row.email,
        hostAccountId: row.host_account_id,
        preferences: {
          location: row.settings.location,
          timezone: row.settings.timezone,
          weeklyLimit: row.settings.weeklyLimit,
          weeklyLimitCounts: row.settings.weeklyLimitCounts,
          weeklyWindows: row.settings.weeklyWindows,
        },
      }
    : null;
}

// A failed or revoked guest-host grant clears the calendar item and reopens the
// Calendar step (design 6): never free time. A request the account itself sent
// (account-requests.ts, the item decided at creation) has no Calendar card to
// reopen, so its item stays and each search pauses until the account reconnects
// Calendar (R01 M-2, P-3).
export async function dropGuestHostCalendars(tx: Transaction, requestId: string) {
  const dropped = await tx`
    update app.requester_host_profiles set items = array_remove(items, 'calendars')
    where request_id = ${requestId} and decided_at is distinct from created_at
  `;
  if (dropped.count === 0) return;
  await tx`update app.requests set calendar_settled_at = null where id = ${requestId}`;
}
