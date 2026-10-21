import { createHmac } from "node:crypto";
import { z } from "zod";
import { type CommandDefinition, CommandError } from "./commands";
import type { Queryable, Transaction } from "./database";
import { deploymentEnvironment } from "./deployment";
import { createGoogleCalendarClient, type GoogleCalendarConfig } from "./google-calendar";
import { type JobHandler, publishJob } from "./jobs";
import { lockOpenRequest } from "./request-guard";
import {
  REQUESTER_CALENDAR_SCOPES,
  readRequesterCalendarGrant,
  requesterCalendarConfigFromEnvironment,
  requesterGrantContext,
} from "./requester-calendar";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// A requester's request-bound Google grants (design decision 3;
// requester-calendar-access). Identity and Calendar are separate rows even when
// one consent screen asked for both: an unchecked Calendar part still records
// identity. Only a calendar grant holds a refresh token, sealed under
// requester_grant:{requestId}. Closure, expiry and **Disconnect** delete the
// sealed token in the closing transaction; Google's revocation endpoint is then
// called (best effort, recorded) by a requester_revocation job only when no other
// live calendar grant of the same Google identity still holds a token, because
// Google revokes per user and client and would otherwise cut that other
// request's access. No requester grant ever creates an auth.users or
// host_accounts row.

export const REQUESTER_REVOCATION_JOB = "requester_revocation";
export const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

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

type LiveGrant = {
  readonly id: string;
  readonly kind: "identity" | "calendar";
  readonly google_subject_hash: string;
  readonly refresh_token_ciphertext: string | null;
  readonly refresh_token_key_id: string | null;
};

// Deletes one grant's sealed token and marks it revoked, in the caller's
// transaction. When it held a token and no other live calendar grant of the same
// Google identity still holds one, a revocation job carries the sealed token to
// Google's endpoint after commit; otherwise deleting the token is the revocation.
// A grant replaced by a new consent of the same identity is never revoked at
// Google: Google revokes per user and client, which would void the new token.
async function closeGrant(tx: Transaction, requestId: string, grant: LiveGrant, replacingSubjectHash?: string) {
  const holdsToken = Boolean(grant.refresh_token_ciphertext && grant.refresh_token_key_id);
  const [shared] = holdsToken
    ? await tx<{ found: boolean }[]>`
        select true as found from app.requester_grants
        where google_subject_hash = ${grant.google_subject_hash} and revoked_at is null and id <> ${grant.id}
          and refresh_token_ciphertext is not null
        limit 1
      `
    : [];
  const revokeAtGoogle = holdsToken && !shared && grant.google_subject_hash !== replacingSubjectHash;

  await tx`
    update app.requester_grants
    set refresh_token_ciphertext = null, refresh_token_key_id = null, revoked_at = now(), updated_at = now(),
        provider_revocation = ${revokeAtGoogle ? null : "not_needed"}
    where id = ${grant.id}
  `;

  if (revokeAtGoogle) {
    await publishJob(tx, {
      dedupeKey: `grant:${grant.id}`,
      kind: REQUESTER_REVOCATION_JOB,
      maxAttempts: 3,
      payload: {
        ciphertext: grant.refresh_token_ciphertext,
        grantId: grant.id,
        keyId: grant.refresh_token_key_id,
        requestId,
      },
    });
  }
}

// Closes the request's live grants (of the given kinds, or all), as closure and
// Disconnect do, or as a new consent replaces them (`replacingSubjectHash`, the
// new consent's identity). Returns how many were closed.
export async function revokeRequestGrants(
  tx: Transaction,
  requestId: string,
  kinds: readonly LiveGrant["kind"][] = ["identity", "calendar"],
  replacingSubjectHash?: string,
) {
  const grants = await tx<LiveGrant[]>`
    select id, kind, google_subject_hash, refresh_token_ciphertext, refresh_token_key_id
    from app.requester_grants
    where request_id = ${requestId} and revoked_at is null and kind in ${tx(kinds as string[])}
    for update
  `;

  for (const grant of grants) await closeGrant(tx, requestId, grant, replacingSubjectHash);
  return grants.length;
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

  await revokeRequestGrants(tx, requestId, calendar ? ["identity", "calendar"] : ["identity"], subjectHash);

  const identityScopes = (identity.scopes ?? []).filter((scope) => !scope.includes("/auth/calendar"));
  await tx`
    insert into app.requester_grants (request_id, kind, google_subject_hash, google_email, email_verified, granted_scopes)
    values (${requestId}, 'identity', ${subjectHash}, ${identity.email}, ${identity.emailVerified}, ${identityScopes})
  `;

  if (calendar) {
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

// **Disconnect**: closes the request's calendar grant (its token is deleted now,
// and revoked at Google when no other request of the identity needs it).
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

// The calendars whose busy times count for this request. Only IDs from the
// requester's own calendar list are offered by the card; the evaluation reads
// whatever is stored here with the request's own grant.
export const selectCalendarsCommand: CommandDefinition<z.infer<typeof selectionInput>, { calendarIds: string[] }> = {
  input: selectionInput,
  operation: "calendar.select",
  async run(tx, context) {
    const requestId = requireRequester(context);
    await lockOpenRequest(tx, requestId);
    const calendarIds = [...new Set(context.input.calendarIds)];
    const updated = await tx`
      update app.requester_grants set calendar_ids = ${calendarIds}, updated_at = now()
      where request_id = ${requestId} and kind = 'calendar' and revoked_at is null
    `;

    if (updated.count === 0) throw new CommandError("invalid_input");
    return { calendarIds };
  },
};

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

// ---------------------------------------------------------------------------
// Revocation at Google

type Environment = Readonly<Record<string, string | undefined>>;

export function revokeUrlFromEnvironment(env: Environment = process.env) {
  return (deploymentEnvironment(env) !== "production" && env.GOOGLE_OAUTH_REVOKE_URL?.trim()) || GOOGLE_OAUTH_REVOKE_URL;
}

export type RevocationDependencies = {
  readonly tokenKeys: readonly TokenKey[];
  readonly revokeUrl: string;
  readonly fetch?: typeof fetch;
};

// Calls Google's revocation endpoint once with the sealed token the closing
// transaction handed over, records the outcome on the grant, and removes the
// token from the job's payload, so no copy outlives the call.
export function createRevocationHandler(
  load: () => RevocationDependencies = () => ({ revokeUrl: revokeUrlFromEnvironment(), tokenKeys: [tokenKeyFromEnvironment()] }),
): JobHandler {
  const handler: JobHandler = async (tx, job) => {
    const { ciphertext, grantId, keyId, requestId } = job.payload as Record<string, string | undefined>;

    if (!grantId || !requestId) return { skipped: true };
    if (!ciphertext || !keyId) return { skipped: true };

    const deps = load();
    let outcome: "revoked" | "failed" = "failed";

    try {
      const token = openToken(deps.tokenKeys, { ciphertext, keyId }, requesterGrantContext(requestId));
      const response = await (deps.fetch ?? fetch)(deps.revokeUrl, {
        body: new URLSearchParams({ token }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      // Google answers 400 invalid_token for a token it already revoked.
      outcome = response.ok || response.status === 400 ? "revoked" : "failed";
    } catch {
      outcome = "failed";
    }

    await tx`update app.requester_grants set provider_revocation = ${outcome}, updated_at = now() where id = ${grantId}`;
    await tx`update app.jobs set payload = payload - 'ciphertext' - 'keyId' where id = ${job.id}`;
    return { outcome };
  };

  return handler;
}
