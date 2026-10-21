import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { REQUEST_LANGUAGES, type RequestDetails, type RequestLanguage, type RequestState } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import { hashBookingId, openBookingLink, sealBookingLink } from "./booking-links";
import { type CommandDefinition, CommandError } from "./commands";
import { issueContactConfirmation } from "./contact-confirmation";
import type { Queryable, Transaction } from "./database";
import { hostAcceptsRequests, type LockedRequest, lockOpenRequest } from "./request-guard";
import { requestExpiresAt } from "./request-lifecycle";
import { recordRequesterGrants, type RequesterGoogleIdentity } from "./requester-grants";
import type { TokenKey } from "./token-encryption";

// One guest thread from the first message (design decision 2, D13).
//
// request.start runs on the guest's first message on a ready host's /{handle}:
// in one transaction it rechecks the host through the shared guard (an unready,
// suspended or unknown host gets the neutral unavailable result), checks the
// draft bounds under advisory locks, and writes a request in the state draft,
// its hashed and sealed booking link and its requester discussion. The route
// then records the message as the discussion's first accepted input, which
// starts the eve session that serves the whole thread. The actor is the
// anonymous starter, identified by the hash of the tab's nonce, and the retry
// key is the nonce itself, so a retried first message creates at most one
// draft and only the tab holding the nonce recovers it. The saved outcome holds
// only the request ID: the route opens the sealed link to answer, so no
// plaintext link is stored with it.
//
// A draft is invisible to the host, accepts at most 30 messages and is deleted
// with its discussion (request-lifecycle.ts, deleteDraft) 24 hours after
// creation unless the guest is identified.
// request.identify (name, email and timezone) or the requester's Google return
// moves it to gathering, sets expires_at to the earlier of creation plus seven
// days and the latest window end, and sends the creation email. The thread and
// the eve session stay the same.

export const START_REQUEST_OPERATION = "request.start";
export const IDENTIFY_REQUEST_OPERATION = "request.identify";

// Drafts created per keyed source address and service-wide (D7).
export const CREATION_LIMITS = {
  perSourceHour: 5,
  perSourceDay: 20,
  serviceDay: 500,
} as const;

export type CreationLimits = { readonly [Key in keyof typeof CREATION_LIMITS]: number };

export const DRAFT_LIMITS = {
  lifetimeHours: 24,
  // Messages a draft accepts before the guest gives a name and email.
  messages: 30,
} as const;

const NONCE = /^[A-Za-z0-9_-]{22,64}$/;

export function isStarterNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE.test(value);
}

// The anonymous starter's actor ID: the hash of the tab's nonce, never the nonce.
export function starterId(nonce: string) {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export const startRequestInput = z
  .object({
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Not a timezone."),
    language: z.enum(REQUEST_LANGUAGES),
  })
  .strict();

export type StartRequestInput = z.infer<typeof startRequestInput>;

export type StartRequestResult = { readonly requestId: string };

async function admitCreation(tx: Transaction, sourceHash: string, limits: CreationLimits) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.request_creation_source:${sourceHash}`}, 0))`;
  await tx`select pg_advisory_xact_lock(hashtextextended('app.request_creation_service', 0))`;

  const [counts] = await tx<{ hour: number; day: number; service: number }[]>`
    select
      count(*) filter (where source_hash = ${sourceHash} and created_at > now() - interval '1 hour')::int as hour,
      count(*) filter (where source_hash = ${sourceHash})::int as day,
      count(*)::int as service
    from app.request_creations
    where created_at > now() - interval '24 hours'
  `;

  if (counts!.hour >= limits.perSourceHour || counts!.day >= limits.perSourceDay || counts!.service >= limits.serviceDay) {
    throw new CommandError("rate_limited");
  }
}

// request.start. resourceId is the host account the public page resolved.
export function startRequestCommand(options: {
  readonly tokenKey: TokenKey;
  // The keyed hash of the caller's source address, for the draft bounds.
  readonly sourceHash: string;
  readonly limits?: Partial<CreationLimits>;
}): CommandDefinition<StartRequestInput, StartRequestResult> {
  const limits = { ...CREATION_LIMITS, ...options.limits };

  return {
    input: startRequestInput,
    operation: START_REQUEST_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "guest_starter") throw new CommandError("forbidden");
      if (!(await hostAcceptsRequests(tx, context.resourceId))) throw new CommandError("forbidden");

      await admitCreation(tx, options.sourceHash, limits);

      const requestId = randomUUID();
      const bookingId = randomUUID();
      const details: RequestDetails = {
        durationMinutes: null,
        language: context.input.language,
        linkPlan: null,
        location: null,
        mode: null,
        purpose: null,
        timezone: context.input.timezone,
        travelMode: null,
        windows: [],
      };

      await tx`
        insert into app.requests (id, host_account_id, state, details, expires_at)
        values (${requestId}, ${context.resourceId}, 'draft', ${tx.json(details as unknown as Parameters<typeof tx.json>[0])},
                now() + make_interval(hours => ${DRAFT_LIMITS.lifetimeHours}))
      `;
      const sealed = sealBookingLink(options.tokenKey, requestId, bookingId);
      await tx`
        insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
        values (${requestId}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
      `;
      await tx`
        insert into app.discussions (principal_type, principal_id, audience)
        values ('requester_request', ${requestId}, 'requester')
      `;
      await tx`
        insert into app.request_creations (source_hash, host_account_id)
        values (${options.sourceHash}, ${context.resourceId})
      `;

      return { requestId };
    },
  };
}

// ---------------------------------------------------------------------------
// Identification

export const identifyRequestInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Not a timezone."),
    language: z.enum(REQUEST_LANGUAGES).optional(),
  })
  .strict();

export type IdentifyRequestInput = z.infer<typeof identifyRequestInput>;

export type IdentifyResult = { readonly revision: number; readonly state: RequestState };

export type IdentifyOptions = {
  // The canonical origin the creation email's links point at.
  readonly origin: string;
  readonly tokenKey: TokenKey;
};

// Moves a locked draft to gathering with the guest's name, email and timezone,
// in the caller's transaction: request.identify and the Google return both call
// it. A verified Google address equal to the email is the confirmed contact,
// and the creation email then carries no confirmation link.
export async function identifyDraft(
  tx: Transaction,
  request: LockedRequest,
  identity: {
    readonly name: string;
    readonly email: string;
    readonly timezone: string;
    readonly language?: RequestLanguage;
    readonly google?: RequesterGoogleIdentity;
  },
  options: IdentifyOptions,
): Promise<IdentifyResult> {
  if (request.state !== "draft") throw new CommandError("invalid_input");
  if (!(await hostAcceptsRequests(tx, request.host_account_id))) throw new CommandError("forbidden");

  const verified = Boolean(
    identity.google?.emailVerified && identity.google.email?.toLowerCase() === identity.email.toLowerCase(),
  );
  const details = {
    ...request.details,
    language: identity.language ?? request.details.language ?? "en",
    timezone: isValidTimeZone(identity.timezone) ? identity.timezone : (request.details.timezone ?? "UTC"),
  };

  await tx`
    update app.requests
    set requester_name = ${identity.name}, contact_email = ${identity.email},
        contact_confirmed_email = ${verified ? identity.email : null},
        details = ${tx.json(details as Parameters<typeof tx.json>[0])},
        state = 'gathering', identified_at = now(),
        identity_requested_at = coalesce(identity_requested_at, now()),
        expires_at = ${requestExpiresAt(request.created_at, details.windows ?? [])},
        revision = revision + 1, updated_at = now()
    where id = ${request.id}
  `;

  // Identification changes no meeting detail, so a review drafted while a
  // draft stays applicable at the new revision.
  await tx`
    update app.request_reviews set base_revision = ${request.revision + 1}
    where request_id = ${request.id} and state = 'pending' and base_revision = ${request.revision}
  `;

  if (identity.google) await recordRequesterGrants(tx, options.tokenKey, request.id, identity.google);

  await issueContactConfirmation(tx, { origin: options.origin, requestId: request.id, tokenKey: options.tokenKey });

  return { revision: request.revision + 1, state: "gathering" };
}

// request.identify: **Continue without Google** on the identity card.
export function identifyRequestCommand(options: IdentifyOptions): CommandDefinition<IdentifyRequestInput, IdentifyResult> {
  return {
    input: identifyRequestInput,
    operation: IDENTIFY_REQUEST_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) {
        throw new CommandError("forbidden");
      }

      const request = await lockOpenRequest(tx, context.actor.id);
      return identifyDraft(tx, request, context.input, options);
    },
  };
}

// Records that the thread now calls for the identity card: a gated operation
// answered identity_required, or the draft reached its message cap. The first
// time is kept, since it is where the card is anchored.
export async function markIdentityRequested(db: Queryable, requestId: string) {
  await db`
    update app.requests set identity_requested_at = coalesce(identity_requested_at, now())
    where id = ${requestId} and state = 'draft'
  `;
}

// The booking UUID of a request, opened from its sealed copy: for an exact
// start retry and the requester's own Google return only.
export async function openRequestBookingId(db: Queryable, keys: readonly TokenKey[], requestId: string) {
  const [link] = await db<{ link_ciphertext: string; link_key_id: string; request_id: string }[]>`
    select request_id, link_ciphertext, link_key_id from app.booking_links where request_id = ${requestId}
  `;
  return link ? openBookingLink(keys, link) : null;
}
