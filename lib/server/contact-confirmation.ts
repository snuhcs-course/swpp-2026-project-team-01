import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { bookingUrl, openBookingLink } from "./booking-links";
import { type CommandDefinition, CommandError } from "./commands";
import type { Database, Queryable, Transaction } from "./database";
import { type DeliveryState, enqueueEmail } from "./email-delivery";
import type { TokenKey } from "./token-encryption";

// Optional contact confirmation (design decision 6). When a request is created,
// and whenever its contact address changes, the same transaction issues the
// creation email: the booking link and, unless the address is already confirmed
// (a Google-verified address equal to the contact), a single-use **Confirm this
// address** link to /booking/confirm/{token}. The token is stored only as a hash
// here and sealed only as the delivery's secret parameter. Opening the link
// shows a **Confirm this address** button; pressing it confirms the address
// while the token is unused and not superseded, the request is open and its
// contact still equals the address. Nothing waits on it.
// **Send the email again** (contact.resend_confirmation) issues a fresh creation
// email to the current contact. The bounds below count every creation email
// (request creation, a contact change and a resend), and both a contact change
// and a resend are checked against them before anything is written.

export const CONFIRMATION_LIMITS = {
  // Seconds between creation emails for one request.
  spacingSeconds: 60,
  perRequestHour: 5,
  perAddressHour: 10,
  serviceDay: 1000,
} as const;

export type ConfirmationLimits = { readonly [Key in keyof typeof CONFIRMATION_LIMITS]: number };

export const RESEND_CONFIRMATION_OPERATION = "contact.resend_confirmation";

// The delivery identity of a creation email a resend issued.
const RESEND_PREFIX = "resend:";

export function hashConfirmationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function confirmationUrl(origin: string, token: string) {
  return `${origin.replace(/\/+$/, "")}/booking/confirm/${token}`;
}

// Voids every live confirmation link of the request: a newer email, a contact
// change and closure all call this in their transaction.
export async function supersedeConfirmations(tx: Transaction, requestId: string) {
  await tx`
    update app.contact_confirmations set superseded_at = now()
    where request_id = ${requestId} and consumed_at is null and superseded_at is null
  `;
}

export type IssueConfirmation = {
  readonly requestId: string;
  // The canonical origin the links point at.
  readonly origin: string;
  readonly tokenKey: TokenKey;
  // The plaintext booking UUID when the caller holds it (request creation);
  // otherwise the sealed copy is opened.
  readonly bookingId?: string;
  // The delivery's identity; one per confirmation by default.
  readonly dedupeKey?: string;
};

export type IssuedConfirmation = {
  readonly deliveryId: string;
  // Null when the address was already confirmed and the email has no link.
  readonly confirmationId: string | null;
};

// Issues the creation email to the request's current contact inside the
// caller's transaction: request.create, a contact change and the resend command
// call this after writing the request. Earlier confirmation links are voided.
export async function issueContactConfirmation(tx: Transaction, issue: IssueConfirmation): Promise<IssuedConfirmation> {
  const [request] = await tx<
    {
      contact_confirmed_email: string | null;
      contact_email: string;
      host_name: string | null;
      language: string | null;
      link_ciphertext: string;
      link_key_id: string;
      requester_name: string;
    }[]
  >`
    select r.contact_email, r.contact_confirmed_email, r.requester_name, r.details ->> 'language' as language,
           s.settings ->> 'displayName' as host_name, l.link_ciphertext, l.link_key_id
    from app.requests r
    join app.booking_links l on l.request_id = r.id
    left join app.host_settings s on s.host_account_id = r.host_account_id
    where r.id = ${issue.requestId}
  `;

  if (!request) throw new CommandError("forbidden");

  const bookingId =
    issue.bookingId ??
    openBookingLink([issue.tokenKey], {
      link_ciphertext: request.link_ciphertext,
      link_key_id: request.link_key_id,
      request_id: issue.requestId,
    });
  const confirmed = request.contact_confirmed_email?.toLowerCase() === request.contact_email.toLowerCase();
  const confirmationId = randomUUID();
  const token = confirmed ? null : randomBytes(32).toString("base64url");

  await supersedeConfirmations(tx, issue.requestId);

  const delivery = await enqueueEmail(tx, {
    dedupeKey: issue.dedupeKey ?? `creation:${confirmationId}`,
    kind: "request_creation",
    language: request.language === "ko" ? "ko" : "en",
    parameters: { hostName: request.host_name ?? undefined, requesterName: request.requester_name },
    recipient: request.contact_email,
    requestId: issue.requestId,
    secrets: {
      bookingUrl: bookingUrl(issue.origin, bookingId),
      ...(token ? { confirmUrl: confirmationUrl(issue.origin, token) } : {}),
    },
    tokenKey: issue.tokenKey,
  });

  if (!token || !delivery.created) return { confirmationId: null, deliveryId: delivery.id };

  await tx`
    insert into app.contact_confirmations (id, request_id, contact_email, token_hash, delivery_id)
    values (${confirmationId}, ${issue.requestId}, ${request.contact_email}, ${hashConfirmationToken(token)}, ${delivery.id})
  `;

  return { confirmationId, deliveryId: delivery.id };
}

export type ConfirmOutcome = "confirmed" | "unavailable";

// **Confirm this address** (POST /api/contact-confirmations, from the page
// /booking/confirm/{token} renders): confirms the address the token was issued
// for, once. Every other case (unknown, used, superseded, a changed contact, a closed
// or expired request) is the same unavailable answer, which reveals nothing.
export async function confirmContact(db: Database, token: string): Promise<ConfirmOutcome> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return "unavailable";

  return db.begin(async (tx) => {
    const [row] = await tx<{ contact_email: string; current: boolean; id: string; request_id: string }[]>`
      select c.id, c.request_id, c.contact_email,
        (
          c.consumed_at is null and c.superseded_at is null
          and r.closed_at is null and r.expires_at > now()
          and lower(r.contact_email) = lower(c.contact_email)
        ) as current
      from app.contact_confirmations c
      join app.requests r on r.id = c.request_id
      where c.token_hash = ${hashConfirmationToken(token)}
      for update of c, r
    `;

    if (!row?.current) return "unavailable";

    await tx`update app.contact_confirmations set consumed_at = now() where id = ${row.id}`;
    // Only the confirmed address changes: no revision, session, agreement or booking.
    await tx`
      update app.requests set contact_confirmed_email = contact_email, updated_at = now()
      where id = ${row.request_id}
    `;
    return "confirmed";
  }) as Promise<ConfirmOutcome>;
}

// When the next creation email may be sent, or null when it may be sent now.
// Every creation email counts, whichever path issued it.
async function nextAllowedAt(db: Queryable, requestId: string, contactEmail: string, limits: ConfirmationLimits) {
  const [row] = await db<{ retry_at: Date | null }[]>`
    with sent as (
      select created_at, request_id, recipients
      from app.email_deliveries
      where kind = 'request_creation' and created_at > now() - interval '24 hours'
    ),
    bounds as (
      select (
        select max(created_at) + make_interval(secs => ${limits.spacingSeconds})
        from sent
        where request_id = ${requestId}
        having max(created_at) > now() - make_interval(secs => ${limits.spacingSeconds})
      ) as spacing,
      (
        select min(created_at) + interval '1 hour' from (
          select created_at from sent
          where request_id = ${requestId} and created_at > now() - interval '1 hour'
          order by created_at desc limit ${limits.perRequestHour}
        ) recent having count(*) >= ${limits.perRequestHour}
      ) as per_request,
      (
        select min(created_at) + interval '1 hour' from (
          select created_at from sent
          where created_at > now() - interval '1 hour' and lower(recipients[1]) = ${contactEmail.toLowerCase()}
          order by created_at desc limit ${limits.perAddressHour}
        ) recent having count(*) >= ${limits.perAddressHour}
      ) as per_address,
      (
        select min(created_at) + interval '24 hours' from (
          select created_at from sent order by created_at desc limit ${limits.serviceDay}
        ) recent having count(*) >= ${limits.serviceDay}
      ) as service
    )
    select greatest(spacing, per_request, per_address, service) as retry_at from bounds
  `;
  return row?.retry_at ?? null;
}

// Takes the recipient's and the service's confirmation locks, after the caller's
// request lock, and returns when the next creation email to `contactEmail` may
// be sent, or null when it may be sent now.
export async function lockConfirmationBounds(
  tx: Transaction,
  requestId: string,
  contactEmail: string,
  limits: ConfirmationLimits = CONFIRMATION_LIMITS,
) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.confirmation_address:${contactEmail.toLowerCase()}`}, 0))`;
  await tx`select pg_advisory_xact_lock(hashtextextended('app.confirmation_service', 0))`;
  return nextAllowedAt(tx, requestId, contactEmail, limits);
}

type OpenRequest = { readonly contact_email: string; readonly contact_confirmed_email: string | null };

async function lockOpenRequest(tx: Transaction, requestId: string): Promise<OpenRequest> {
  const [request] = await tx<(OpenRequest & { open: boolean })[]>`
    select r.contact_email, r.contact_confirmed_email,
           (r.closed_at is null and r.expires_at > now() and l.expires_at > now()) as open
    from app.requests r
    join app.booking_links l on l.request_id = r.id
    where r.id = ${requestId}
    for update of r
  `;

  if (!request?.open) throw new CommandError("forbidden");
  return request;
}

export type ResendConfirmationResult =
  | { readonly status: "queued"; readonly deliveryId: string }
  | { readonly status: "limited"; readonly retryAt: string };

// contact.resend_confirmation: a fresh creation email to the current contact,
// with a new confirmation link that voids the earlier ones. The actor is the
// requester holding the booking link; runCommand's retry key makes a lost
// response recover the saved status without a second email. Past a bound,
// nothing is created and the result says when it can be sent again.
export function resendConfirmationCommand(options: {
  readonly origin: string;
  readonly tokenKey: TokenKey;
  readonly limits?: Partial<ConfirmationLimits>;
}): CommandDefinition<Record<string, never>, ResendConfirmationResult> {
  const limits = { ...CONFIRMATION_LIMITS, ...options.limits };

  return {
    input: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    operation: RESEND_CONFIRMATION_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
        throw new CommandError("forbidden");
      }

      const requestId = context.actor.id;
      const request = await lockOpenRequest(tx, requestId);
      // Request lock first (above), then the recipient's, then the service's.
      const retryAt = await lockConfirmationBounds(tx, requestId, request.contact_email, limits);

      if (retryAt) return { retryAt: retryAt.toISOString(), status: "limited" };

      const issued = await issueContactConfirmation(tx, {
        dedupeKey: `${RESEND_PREFIX}${requestId}:${context.correlationId}`,
        origin: options.origin,
        requestId,
        tokenKey: options.tokenKey,
      });
      return { deliveryId: issued.deliveryId, status: "queued" };
    },
  };
}

// The card's states, from the delivery and confirmation rows.
export type ConfirmationDeliveryStatus = "queued" | "sent" | "rejected" | "uncertain" | "suppressed";

export type ConfirmationStatus = {
  readonly confirmed: boolean;
  // The latest creation email to the current contact.
  readonly delivery: ConfirmationDeliveryStatus | null;
  // When **Send the email again** is next allowed; null when it is allowed now.
  readonly retryAt: string | null;
};

const CARD_STATE: Readonly<Record<DeliveryState, ConfirmationDeliveryStatus>> = {
  accepted: "sent",
  dispatching: "queued",
  queued: "queued",
  rejected: "rejected",
  suppressed: "suppressed",
  uncertain: "uncertain",
};

export async function readConfirmationStatus(
  db: Queryable,
  requestId: string,
  limits: Partial<ConfirmationLimits> = {},
): Promise<ConfirmationStatus | null> {
  const [request] = await db<{ confirmed: boolean; contact_email: string; state: DeliveryState | null }[]>`
    select r.contact_email,
           coalesce(lower(r.contact_confirmed_email) = lower(r.contact_email), false) as confirmed,
           (
             select d.state from app.email_deliveries d
             where d.request_id = r.id and d.kind = 'request_creation'
               and lower(d.recipients[1]) = lower(r.contact_email)
             order by d.created_at desc limit 1
           ) as state
    from app.requests r
    where r.id = ${requestId}
  `;

  if (!request) return null;

  const retryAt = await nextAllowedAt(db, requestId, request.contact_email, { ...CONFIRMATION_LIMITS, ...limits });
  return {
    confirmed: request.confirmed,
    delivery: request.state ? CARD_STATE[request.state] : null,
    retryAt: retryAt?.toISOString() ?? null,
  };
}
