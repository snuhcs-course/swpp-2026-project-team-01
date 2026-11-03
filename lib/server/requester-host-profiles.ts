import { z } from "zod";
import { REQUESTER_TRAVEL_MODES, type ReviewPatch } from "../contracts/request";
import { HOST_PROFILE_ITEMS, type HostProfileItem, type RequesterHostProfileView } from "../contracts/requester-view";
import type { ConfirmedSettings } from "../contracts/setup";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { assertIdentified, type LockedRequest, lockOpenRequest } from "./request-guard";

// A guest who is a host (guest-flow-completion design 6, D7 and D8). On the
// requester Google return, the verified Google subject is compared with host
// accounts' Google identities; an active host with confirmed settings that is
// not the request's host is recorded, and the thread offers **Use your host
// settings for this request**. Nothing is used before the guest decides, and
// the choice lives with the request until it closes. Nothing here reaches the
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
    join app.host_settings s on s.host_account_id = g.host_account_id
    where r.id = ${requestId} and g.host_account_id <> r.host_account_id
    on conflict (request_id) do nothing
  `;
}

type ProfileRow = { host_account_id: string; items: HostProfileItem[]; decided_at: Date | null };

async function profileOf(q: Queryable, requestId: string, lock = false) {
  const [row] = lock
    ? await q<ProfileRow[]>`
        select host_account_id, items, decided_at from app.requester_host_profiles where request_id = ${requestId} for update
      `
    : await q<ProfileRow[]>`
        select host_account_id, items, decided_at from app.requester_host_profiles where request_id = ${requestId}
      `;
  return row ?? null;
}

export async function readHostProfileView(q: Queryable, requestId: string): Promise<RequesterHostProfileView | null> {
  const profile = await profileOf(q, requestId);
  if (!profile) return null;
  return { decided: profile.decided_at !== null, items: profile.items, offered: HOST_PROFILE_ITEMS };
}

const decideInput = z.object({ items: z.array(z.enum(HOST_PROFILE_ITEMS)).max(HOST_PROFILE_ITEMS.length) }).strict();

// request.host_profile.decide: **Use these settings** with the checked items,
// or **Not now** with none; **Change** on the receipt decides again. Calendars
// settle the Calendar step (the evaluation also counts any calendars connected
// for the request); taking them back reopens it unless such a grant exists. Basic details become a pending
// review the guest applies.
export function decideHostProfileCommand(): CommandDefinition<z.infer<typeof decideInput>, { items: HostProfileItem[] }> {
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

      return { items };
    },
  };
}

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
  return row ? { conflictCalendars: row.settings.conflictCalendars, email: row.email, hostAccountId: row.host_account_id } : null;
}

// A failed or revoked guest-host grant clears the calendar item and reopens the
// Calendar step (design 6): never free time.
export async function dropGuestHostCalendars(tx: Transaction, requestId: string) {
  await tx`
    update app.requester_host_profiles set items = array_remove(items, 'calendars') where request_id = ${requestId}
  `;
  await tx`update app.requests set calendar_settled_at = null where id = ${requestId}`;
}
