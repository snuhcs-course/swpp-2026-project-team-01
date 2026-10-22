import { createHmac } from "node:crypto";
import { z } from "zod";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { createGoogleCalendarClient, type GoogleCalendarConfig } from "./google-calendar";
import { assertIdentified, lockOpenRequest } from "./request-guard";
import {
  REQUESTER_CALENDAR_SCOPES,
  readRequesterCalendarGrant,
  requesterCalendarConfigFromEnvironment,
  requesterGrantContext,
} from "./requester-calendar";
import { sealToken, type TokenKey } from "./token-encryption";

// A requester's request-bound Google grants (design decision 3;
// requester-calendar-access). Identity and Calendar are separate rows even when
// one consent screen asked for both: an unchecked Calendar part still records
// identity. Only a calendar grant holds a refresh token, sealed under
// requester_grant:{requestId}. Closure, expiry and **Disconnect** delete the
// sealed token in the closing transaction and never call Google's revocation
// endpoint (delete-only), so the requester client may be the host sign-in client
// without a requester's closure touching the same person's host Calendar grant.
// No requester grant ever creates an auth.users or host_accounts row.

// What the consent round trip learned about the requester's Google identity.
export type RequesterGoogleIdentity = {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  // Scopes Google reports as granted; null when they could not be read, which
  // records no Calendar grant.
  readonly scopes: readonly string[] | null;
  readonly refreshToken: string | null;
};

// A keyed hash of the Google subject, so grants of one identity can be matched
// across requests without storing the subject.
export function googleSubjectHash(key: TokenKey, subject: string) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/requester-google-subject/v1").digest();
  return createHmac("sha256", derived).update(subject).digest("hex");
}

export function hasCalendarScopes(scopes: readonly string[] | null) {
  return Boolean(scopes && REQUESTER_CALENDAR_SCOPES.every((scope) => scopes.includes(scope)));
}

type GrantKind = "identity" | "calendar";

// Closes the request's live grants (of the given kinds, or all), as closure,
// expiry and Disconnect do, or as a new consent replaces them: each sealed token
// is deleted and the grant marked revoked in the caller's transaction. Grants are
// delete-only (product decision D8): the service holds the only copy of the
// token, so deleting it ends the service's access, and Google's revocation
// endpoint is never called. provider_revocation is therefore always 'not_needed'
// ('revoked' and 'failed' remain in the CHECK from the first migration but are
// no longer written). Returns how many were closed.
export async function revokeRequestGrants(
  tx: Transaction,
  requestId: string,
  kinds: readonly GrantKind[] = ["identity", "calendar"],
) {
  const closed = await tx`
    update app.requester_grants
    set refresh_token_ciphertext = null, refresh_token_key_id = null, revoked_at = now(), updated_at = now(),
        provider_revocation = 'not_needed'
    where request_id = ${requestId} and revoked_at is null and kind in ${tx(kinds as string[])}
  `;
  return closed.count;
}

// Records the grants of one completed consent for an open request, replacing the
// request's earlier grant of each kind that the consent covers. The calendar
// grant exists only when Google reported both Calendar scopes and returned a
// refresh token; its calendars start empty, which reads the primary calendar.
export async function recordRequesterGrants(
  tx: Transaction,
  tokenKey: TokenKey,
  requestId: string,
  identity: RequesterGoogleIdentity,
) {
  const subjectHash = googleSubjectHash(tokenKey, identity.subject);
  const calendar = hasCalendarScopes(identity.scopes) && identity.refreshToken !== null;

  await revokeRequestGrants(tx, requestId, calendar ? ["identity", "calendar"] : ["identity"]);

  const identityScopes = (identity.scopes ?? []).filter((scope) => !scope.includes("/auth/calendar"));
  await tx`
    insert into app.requester_grants (request_id, kind, google_subject_hash, google_email, email_verified, granted_scopes)
    values (${requestId}, 'identity', ${subjectHash}, ${identity.email}, ${identity.emailVerified}, ${identityScopes})
  `;

  if (calendar) {
    // A new Calendar grant reopens the step, so its calendars can be chosen.
    await tx`update app.requests set calendar_settled_at = null where id = ${requestId}`;
    const sealed = sealToken(tokenKey, identity.refreshToken!, requesterGrantContext(requestId));
    await tx`
      insert into app.requester_grants
        (request_id, kind, google_subject_hash, google_email, email_verified, granted_scopes,
         refresh_token_ciphertext, refresh_token_key_id)
      values (${requestId}, 'calendar', ${subjectHash}, ${identity.email}, ${identity.emailVerified},
              ${[...identity.scopes!]}, ${sealed.ciphertext}, ${sealed.keyId})
    `;
  }

  return { calendar, identity: true };
}

// The requester projection of the request's grants: whether identity and
// Calendar are connected, the verified Google address only when it equals the
// contact (Use verified Google email), and the selected calendars.
export type RequesterConnection = {
  readonly identity: boolean;
  readonly calendar: boolean;
  readonly calendarIds: readonly string[];
  // True when the verified Google address equals the current, unconfirmed contact.
  readonly canUseGoogleEmail: boolean;
};

export async function readRequesterConnection(db: Queryable, requestId: string): Promise<RequesterConnection> {
  const rows = await db<
    { calendar_ids: string[]; email_verified: boolean; google_email: string | null; kind: string; matches: boolean; confirmed: boolean }[]
  >`
    select g.kind, g.calendar_ids, g.email_verified, g.google_email,
           lower(coalesce(g.google_email, '')) = lower(r.contact_email) as matches,
           coalesce(lower(r.contact_confirmed_email) = lower(r.contact_email), false) as confirmed
    from app.requester_grants g
    join app.requests r on r.id = g.request_id
    where g.request_id = ${requestId} and g.revoked_at is null
  `;
  const identity = rows.find((row) => row.kind === "identity");
  const calendar = rows.find((row) => row.kind === "calendar");

  return {
    calendar: Boolean(calendar),
    calendarIds: calendar?.calendar_ids ?? [],
    canUseGoogleEmail: Boolean(identity?.email_verified && identity.matches && !identity.confirmed),
    identity: Boolean(identity),
  };
}

// ---------------------------------------------------------------------------
// Commands on the booking page

function requireRequester(context: { actor: { kind: string; id: string }; resourceId: string }) {
  if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
    throw new CommandError("forbidden");
  }
  return context.actor.id;
}

const empty = z.object({}).strict() as unknown as z.ZodType<Record<string, never>>;

// **Use verified Google email**: confirms the contact only when the request's
// live identity grant reports a verified address equal to it; nothing else changes.
export const useGoogleEmailCommand: CommandDefinition<Record<string, never>, { confirmed: boolean }> = {
  input: empty,
  operation: "contact.use_google_email",
  async run(tx, context) {
    const requestId = requireRequester(context);
    await lockOpenRequest(tx, requestId);

    const updated = await tx`
      update app.requests r set contact_confirmed_email = r.contact_email, updated_at = now()
      from app.requester_grants g
      where r.id = ${requestId} and g.request_id = r.id and g.kind = 'identity' and g.revoked_at is null
        and g.email_verified and lower(g.google_email) = lower(r.contact_email)
    `;

    if (updated.count === 0) throw new CommandError("invalid_input");
    return { confirmed: true };
  },
};

// **Disconnect**: closes the request's calendar grant; its sealed token is
// deleted now, and Google is not called.
export const disconnectCalendarCommand: CommandDefinition<Record<string, never>, { disconnected: boolean }> = {
  input: empty,
  operation: "calendar.disconnect",
  async run(tx, context) {
    const requestId = requireRequester(context);
    await lockOpenRequest(tx, requestId);
    return { disconnected: (await revokeRequestGrants(tx, requestId, ["calendar"])) > 0 };
  },
};

const selectionInput = z.object({ calendarIds: z.array(z.string().min(1).max(1024)).min(1).max(20) }).strict();

// The calendars whose busy times count for this request. Every ID must be on the
// requester's live calendar list, read with the request's own grant (`primary`
// names the primary calendar); an unknown ID, or a list that cannot be read,
// rejects the choice.
export function selectCalendarsCommand(options: {
  readonly tokenKey: TokenKey;
  readonly config?: () => GoogleCalendarConfig;
}): CommandDefinition<z.infer<typeof selectionInput>, { calendarIds: string[] }> {
  return {
    input: selectionInput,
    operation: "calendar.select",
    async run(tx, context) {
      const requestId = requireRequester(context);
      await lockOpenRequest(tx, requestId);
      const calendarIds = [...new Set(context.input.calendarIds)];
      const listed = await listRequesterCalendars(
        tx,
        [options.tokenKey],
        requestId,
        (options.config ?? requesterCalendarConfigFromEnvironment)(),
      );
      const known = new Set(listed?.map((calendar) => calendar.id));

      if (listed?.some((calendar) => calendar.primary)) known.add("primary");
      if (calendarIds.some((id) => !known.has(id))) throw new CommandError("invalid_input");

      const updated = await tx`
        update app.requester_grants set calendar_ids = ${calendarIds}, updated_at = now()
        where request_id = ${requestId} and kind = 'calendar' and revoked_at is null
      `;

      if (updated.count === 0) throw new CommandError("invalid_input");
      await tx`update app.requests set calendar_settled_at = now() where id = ${requestId}`;
      return { calendarIds };
    },
  };
}

export type RequesterCalendarOption = {
  readonly id: string;
  readonly summary: string;
  readonly primary: boolean;
  readonly selected: boolean;
};

// The requester's own calendar list for the selection card, read live with the
// request's calendar grant; the primary calendar is preselected until the
// requester saves a choice. Null when the grant is missing or unreadable.
export async function listRequesterCalendars(
  db: Queryable,
  keys: readonly TokenKey[],
  requestId: string,
  config: GoogleCalendarConfig = requesterCalendarConfigFromEnvironment(),
): Promise<RequesterCalendarOption[] | null> {
  try {
    const grant = await readRequesterCalendarGrant(db, keys, requestId);
    if (!grant) return null;

    const stored = await db<{ calendar_ids: string[] }[]>`
      select calendar_ids from app.requester_grants
      where request_id = ${requestId} and kind = 'calendar' and revoked_at is null
    `;
    const chosen = stored[0]?.calendar_ids ?? [];
    const client = createGoogleCalendarClient(config, grant.refreshToken, async () => {});
    const { calendars } = await client.listCalendars();

    return calendars.map((calendar) => ({
      id: calendar.id,
      primary: calendar.primary === true,
      selected:
        chosen.length > 0
          ? chosen.includes(calendar.id) || (calendar.primary === true && chosen.includes("primary"))
          : calendar.primary === true,
      summary: calendar.summary,
    }));
  } catch {
    return null;
  }
}

const manualInput = z.object({ manual: z.boolean() }).strict();

// request.set_manual_availability: **Skip for now** on the Calendar card
// (manual: true) settles the Calendar step on the server, so a reload or
// another tab does not offer it again and the thread moves to the next step;
// **Change** on its receipt (manual: false) offers the Calendar card again.
export const setManualAvailabilityCommand: CommandDefinition<z.infer<typeof manualInput>, { manual: boolean }> = {
  input: manualInput,
  operation: "request.set_manual_availability",
  async run(tx, context) {
    const requestId = requireRequester(context);
    const request = await lockOpenRequest(tx, requestId);
    assertIdentified(request);

    await tx`
      update app.requests set calendar_settled_at = case when ${context.input.manual} then now() end
      where id = ${requestId}
    `;
    return { manual: context.input.manual };
  },
};
