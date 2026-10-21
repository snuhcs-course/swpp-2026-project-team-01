import { randomUUID } from "node:crypto";
import { z } from "zod";
import { REQUEST_LANGUAGES, type RequestDetails } from "../contracts/request";
import { isValidTimeZone } from "../contracts/timezone";
import { hashBookingId, openBookingLink, sealBookingLink } from "./booking-links";
import { type CommandDefinition, CommandError } from "./commands";
import { issueContactConfirmation } from "./contact-confirmation";
import type { Queryable, Transaction } from "./database";
import { displayTime } from "./feasibility";
import { draftReviewPatch, hostAcceptsRequests, type IntakeDraft, IntakeUnavailableError, lockOpenIntake } from "./intakes";
import { protectInput } from "./redaction";
import { requestExpiresAt } from "./request-lifecycle";
import { recordRequesterGrants, type RequesterGoogleIdentity } from "./requester-grants";
import type { TokenKey } from "./token-encryption";

// request.create (design decision 2): the anonymous intake continues, with or
// without Google, into exactly one request. The actor is the intake and the
// retry key is its token's hash, so one intake creates at most one request and
// only the tab holding the token (or the Google return it started) recovers the
// outcome. In one transaction it rechecks the host through the shared guard
// (an unready, suspended or unknown host gets the neutral unavailable result),
// checks the creation bounds under advisory locks, and writes the request in
// gathering, its hashed and sealed booking link, the requester discussion, the
// intake draft as a pending review, the Google grants, the creation email, the
// application-authored summary that is the request session's first input, and
// the intake's closure. The saved outcome holds only the request ID: the route
// opens the sealed link to answer, so no plaintext link is stored with it.

export const CREATE_REQUEST_OPERATION = "request.create";

export const CREATION_LIMITS = {
  perSourceHour: 5,
  perSourceDay: 20,
  serviceDay: 500,
} as const;

export type CreationLimits = { readonly [Key in keyof typeof CREATION_LIMITS]: number };

export const createRequestInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    timezone: z.string().refine(isValidTimeZone),
    language: z.enum(REQUEST_LANGUAGES),
  })
  .strict();

export type CreateRequestInput = z.infer<typeof createRequestInput>;

export type CreateRequestResult = { readonly requestId: string };

export type CreateRequestOptions = {
  // The canonical origin the creation email's links point at.
  readonly origin: string;
  readonly tokenKey: TokenKey;
  // The conversation signing key, for the summary input's protected fingerprint.
  readonly signingKey: string;
  // The keyed hash of the caller's source address, for the creation bounds.
  readonly sourceHash: string;
  // The identity a Google return carries; absent for Continue without Google.
  readonly google?: RequesterGoogleIdentity;
  readonly limits?: Partial<CreationLimits>;
};

// The authored summary the request session starts from. It names what the
// visitor drafted (already theirs to see) and only the presence of contact
// details, never the values.
export function intakeSummary(draft: IntakeDraft, timezone: string) {
  const lines: string[] = [];

  if (draft.purpose) lines.push(`- Purpose: ${draft.purpose}`);
  if (draft.durationMinutes) lines.push(`- Duration: ${draft.durationMinutes} minutes`);
  if (draft.mode) lines.push(`- Meeting mode: ${draft.mode.replace("_", " ")}`);
  if (draft.location) lines.push(`- Place: ${draft.location}`);
  for (const window of draft.windows ?? []) {
    lines.push(`- Available: ${displayTime(new Date(window.start), timezone)} to ${displayTime(new Date(window.end), timezone)}`);
  }

  return [
    "Intake summary from the public page, written by Find Me a Time (not a message from the requester).",
    "The request now exists. The requester's name and contact email are on file.",
    lines.length > 0
      ? `Drafted on the public page, waiting for the requester to apply or dismiss on the review card:\n${lines.join("\n")}`
      : "Nothing about the meeting was drafted on the public page yet.",
    "Greet the requester briefly in their language and help them with the next missing detail.",
  ].join("\n\n");
}

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

export function createRequestCommand(options: CreateRequestOptions): CommandDefinition<CreateRequestInput, CreateRequestResult> {
  const limits = { ...CREATION_LIMITS, ...options.limits };

  return {
    input: createRequestInput,
    operation: CREATE_REQUEST_OPERATION,
    async run(tx, context) {
      if (context.actor.kind !== "public_intake" || context.actor.id !== context.resourceId) {
        throw new CommandError("forbidden");
      }

      let intake: Awaited<ReturnType<typeof lockOpenIntake>>;

      try {
        intake = await lockOpenIntake(tx, context.actor.id);
      } catch (error) {
        if (error instanceof IntakeUnavailableError) throw new CommandError("forbidden");
        throw error;
      }

      if (intake.request_id || !(await hostAcceptsRequests(tx, intake.host_account_id))) {
        throw new CommandError("forbidden");
      }

      await admitCreation(tx, options.sourceHash, limits);

      const { input } = context;
      const requestId = randomUUID();
      const bookingId = randomUUID();
      const [clock] = await tx<{ now: Date }[]>`select now() as now`;
      const details: RequestDetails = {
        durationMinutes: null,
        language: input.language,
        linkPlan: null,
        location: null,
        mode: null,
        purpose: null,
        timezone: input.timezone,
        travelMode: null,
        windows: [],
      };
      const verified = options.google?.emailVerified && options.google.email?.toLowerCase() === input.email.toLowerCase();

      await tx`
        insert into app.requests
          (id, host_account_id, details, requester_name, contact_email, contact_confirmed_email, expires_at)
        values
          (${requestId}, ${intake.host_account_id}, ${tx.json(details as unknown as Parameters<typeof tx.json>[0])},
           ${input.name}, ${input.email}, ${verified ? input.email : null}, ${requestExpiresAt(clock!.now)})
      `;
      const sealed = sealBookingLink(options.tokenKey, requestId, bookingId);
      await tx`
        insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
        values (${requestId}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
      `;
      const [discussion] = await tx<{ id: string }[]>`
        insert into app.discussions (principal_type, principal_id, audience)
        values ('requester_request', ${requestId}, 'requester')
        returning id
      `;

      const patch = draftReviewPatch(intake.draft);
      if (patch) {
        await tx`
          insert into app.request_reviews (request_id, base_revision, intent, patch)
          values (${requestId}, 1, 'details', ${tx.json(patch as Parameters<typeof tx.json>[0])})
        `;
      }

      await tx`update app.intakes set request_id = ${requestId}, closed_at = now() where id = ${intake.id}`;
      await tx`
        insert into app.request_creations (source_hash, host_account_id)
        values (${options.sourceHash}, ${intake.host_account_id})
      `;

      if (options.google) await recordRequesterGrants(tx, options.tokenKey, requestId, options.google);

      await issueContactConfirmation(tx, { bookingId, origin: options.origin, requestId, tokenKey: options.tokenKey });

      // The request session's first input, delivered when the booking page opens it.
      const summary = protectInput(options.signingKey, intakeSummary(intake.draft, input.timezone));
      await tx`
        insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, protected_fingerprint, message)
        values (${discussion!.id}, ${randomUUID()}, ${summary.fingerprint}, ${summary.protectedFingerprint}, ${summary.message})
      `;

      return { requestId };
    },
  };
}

// The booking UUID of a request, opened from its sealed copy: for an exact
// creation retry and the requester's own Google return only.
export async function openRequestBookingId(db: Queryable, keys: readonly TokenKey[], requestId: string) {
  const [link] = await db<{ link_ciphertext: string; link_key_id: string; request_id: string }[]>`
    select request_id, link_ciphertext, link_key_id from app.booking_links where request_id = ${requestId}
  `;
  return link ? openBookingLink(keys, link) : null;
}
