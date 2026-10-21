import { z } from "zod";
import { clarificationQuestion, parseClarifications } from "../contracts/clarifications";
import {
  CLARIFICATION_CATEGORIES,
  type ClarificationCategory,
  type LinkPlan,
  type RequestDetails,
  type RequestLanguage,
  REQUESTER_TRAVEL_MODES,
  type RequestState,
  type RequestWindow,
  REVIEW_INTENTS,
  type ReviewIntent,
  type ReviewPatch,
} from "../contracts/request";
import { MEETING_MODES } from "../contracts/setup";
import { isValidTimeZone } from "../contracts/timezone";
import { assertRevision, type CommandDefinition, CommandError } from "./commands";
import { CONFIRMATION_LIMITS, type ConfirmationLimits, issueContactConfirmation, lockConfirmationBounds } from "./contact-confirmation";
import type { Transaction } from "./database";
import { type LocalWindow, localWindowSchema, resolveLocalWindow, type WindowProblem } from "./intakes";
import { type LockedRequest, lockOpenRequest } from "./request-guard";
import { requestExpiresAt } from "./request-lifecycle";
import type { TokenKey } from "./token-encryption";

// Requester reviews and details (design decision 12; meeting-requests: declared
// uncertain extraction, temporally valid review windows, review time validation,
// minimized structured contact context). Extraction is advisory: it declares
// details, availability, question or unknown intent; question and unknown carry
// no patch and at least one authored clarification category; details and
// availability carry a patch whose windows start in the future and fit the known
// duration (an omitted duration is never invented). A valid draft becomes the
// one pending review, superseding the earlier one, and changes nothing else.
// Only the requester's **Apply these details** (request.apply_review) changes
// the request, at the expected revision, after rechecking the windows against
// the clock once the request lock is held. **Dismiss** records rejected. The
// meeting details card (request.update_details) applies the same validation
// directly, so details can be set while the model is unavailable.

export const DRAFT_REVIEW_OPERATION = "request.draft_review";
export const APPLY_REVIEW_OPERATION = "request.apply_review";
export const DISMISS_REVIEW_OPERATION = "request.dismiss_review";
export const UPDATE_DETAILS_OPERATION = "request.update_details";

// ---------------------------------------------------------------------------
// Patches

const httpsLink = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "A meeting link must start with https://.");

const isoWindow = z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).strict();

const linkPlanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("google_meet") }).strict(),
  z.object({ kind: z.literal("requester_link"), url: httpsLink }).strict(),
]);

// A stored patch: instants, not local times, so validation against the clock is
// the only time-dependent step.
export const reviewPatchSchema = z
  .object({
    purpose: z.string().trim().min(1).max(500).optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    mode: z.enum(MEETING_MODES).optional(),
    location: z.string().trim().min(1).max(300).optional(),
    linkPlan: linkPlanSchema.optional(),
    windows: z.array(isoWindow).min(1).max(10).optional(),
    travelMode: z.enum(REQUESTER_TRAVEL_MODES).optional(),
    contactName: z.string().trim().max(200).optional(),
    contactEmail: z.string().trim().max(320).optional(),
  })
  .strict();

// What the model and the meeting details card send: local dates and clock times
// in a named zone, which the service converts, and a meeting link as text.
export const localPatchSchema = z
  .object({
    purpose: z.string().trim().min(1).max(500).optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    mode: z.enum(MEETING_MODES).optional(),
    location: z.string().trim().min(1).max(300).optional(),
    meetingLink: httpsLink.optional(),
    windows: z.array(localWindowSchema).min(1).max(10).optional(),
    travelMode: z.enum(REQUESTER_TRAVEL_MODES).optional(),
    contactName: z.string().trim().max(200).optional(),
    contactEmail: z.string().trim().max(320).optional(),
  })
  .strict();

export type LocalPatch = z.infer<typeof localPatchSchema>;

export type PatchProblem =
  | WindowProblem
  | "started_window"
  | "empty_patch"
  | "patch_on_question"
  | "missing_clarification"
  | "unsupported_clarification"
  | "invalid_contact"
  | "awaiting_host_approval";

// Converts a local patch to a stored one in `timeZone`. A local time a clock
// change repeats or skips, or a date that does not exist, rejects the whole
// patch; nothing about the clock is checked here.
export function storedPatch(
  patch: LocalPatch,
  timeZone: string,
): { readonly ok: true; readonly patch: ReviewPatch } | { readonly ok: false; readonly problem: WindowProblem; readonly window: LocalWindow } {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const { meetingLink, windows: local, ...fields } = patch;
  const windows: RequestWindow[] = [];

  for (const window of local ?? []) {
    // now = 0: only the conversion runs; the clock is checked by the command.
    const resolved = resolveLocalWindow(window, zone, { now: 0 });
    if (!resolved.ok) return { ok: false, problem: resolved.problem, window };
    windows.push(resolved.window);
  }

  return {
    ok: true,
    patch: {
      ...fields,
      ...(meetingLink ? { linkPlan: { kind: "requester_link", url: meetingLink } satisfies LinkPlan } : {}),
      ...(local ? { windows: windows.sort((a, b) => a.start.localeCompare(b.start)) } : {}),
    },
  };
}

// Whether the windows the patch proposes still start in the future and, with the
// duration merged from the patch and the current details, fit it. Windows the
// patch does not touch are checked for fit only when the patch changes the
// duration.
export function checkWindows(details: Partial<RequestDetails>, patch: ReviewPatch, now: number): PatchProblem | null {
  const duration = patch.durationMinutes ?? details.durationMinutes ?? null;

  for (const window of patch.windows ?? []) {
    if (Date.parse(window.start) <= now) return "started_window";
  }

  const windows = patch.windows ?? (patch.durationMinutes ? (details.windows ?? []) : []);

  for (const window of windows) {
    const length = Date.parse(window.end) - Date.parse(window.start);
    if (length <= 0 || (duration && length < duration * 60_000)) return "too_short";
  }

  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// An explicitly emptied contact field may be drafted, for protected review, but
// never applied: name and email stay required.
function contactProblem(patch: ReviewPatch, options: { readonly draft?: boolean } = {}): PatchProblem | null {
  const empty = (value: string) => value.trim() === "";

  if (patch.contactName !== undefined && empty(patch.contactName) && !options.draft) return "invalid_contact";
  if (patch.contactEmail !== undefined) {
    if (empty(patch.contactEmail) ? !options.draft : !EMAIL.test(patch.contactEmail)) return "invalid_contact";
  }
  return null;
}

export function applyPatch(details: Partial<RequestDetails>, patch: ReviewPatch): Partial<RequestDetails> {
  const { contactEmail: _email, contactName: _name, ...fields } = patch;
  return { ...details, ...fields };
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function detailsChanged(before: Partial<RequestDetails>, after: Partial<RequestDetails>) {
  return (Object.keys(after) as (keyof RequestDetails)[]).some((key) => !sameJson(before[key], after[key]));
}

export function hasPatchFields(patch: ReviewPatch) {
  return Object.values(patch).some((value) => value !== undefined);
}

// The request's language for authored questions.
export function requestLanguage(details: Partial<RequestDetails>): RequestLanguage {
  return details.language === "ko" ? "ko" : "en";
}

async function clock(tx: Transaction) {
  // clock_timestamp, not now(): the check happens after the lock wait.
  const [row] = await tx<{ now: Date }[]>`select clock_timestamp() as now`;
  return row!.now.getTime();
}

type ContactOptions = {
  readonly origin: string;
  readonly tokenKey: TokenKey;
  readonly limits?: Partial<ConfirmationLimits>;
};

// Writes a changed request after a review or the details card: the merged
// details and contact, the next revision, the recomputed expiry and, when
// details changed in negotiation, the return to gathering. A changed contact
// address voids its confirmation and is emailed its own creation email, within
// the creation email bounds: past one, the change is rejected before anything
// is written.
async function writeDetails(
  tx: Transaction,
  request: LockedRequest & { readonly requester_name: string },
  patch: ReviewPatch,
  options: ContactOptions,
): Promise<{ revision: number; state: RequestState }> {
  const details = applyPatch(request.details, patch);
  const changed = detailsChanged(request.details, details);
  const name = patch.contactName?.trim() || request.requester_name;
  const email = patch.contactEmail?.trim() || request.contact_email;
  const emailChanged = email.toLowerCase() !== request.contact_email.toLowerCase();
  const state: RequestState = changed && request.state === "negotiating" ? "gathering" : request.state;
  const confirmed = emailChanged ? null : request.contact_confirmed_email;

  if (emailChanged) {
    const limits = { ...CONFIRMATION_LIMITS, ...options.limits };
    // The request lock is held; then the new recipient's and the service's.
    if (await lockConfirmationBounds(tx, request.id, email, limits)) throw new CommandError("rate_limited");
  }

  await tx`
    update app.requests
    set details = ${tx.json(details as Parameters<typeof tx.json>[0])}, requester_name = ${name},
        contact_email = ${email}, contact_confirmed_email = ${confirmed && confirmed.toLowerCase() === email.toLowerCase() ? email : null},
        expires_at = ${requestExpiresAt(request.created_at, details.windows ?? [])},
        state = ${state}, revision = revision + 1, updated_at = now()
    where id = ${request.id}
  `;

  if (emailChanged) await issueContactConfirmation(tx, { origin: options.origin, requestId: request.id, tokenKey: options.tokenKey });

  return { revision: request.revision + 1, state };
}

async function lockRequester(tx: Transaction, context: { readonly actor: { kind: string; id: string }; readonly resourceId: string }) {
  if (context.actor.kind !== "requester_request" || context.actor.id !== context.resourceId) throw new CommandError("forbidden");

  const request = await lockOpenRequest(tx, context.actor.id);
  const [row] = await tx<{ requester_name: string }[]>`select requester_name from app.requests where id = ${request.id}`;
  return { ...request, requester_name: row!.requester_name };
}

// ---------------------------------------------------------------------------
// request.draft_review

export const draftReviewInput = z
  .object({
    intent: z.enum(REVIEW_INTENTS),
    patch: reviewPatchSchema.nullable(),
    clarifications: z.array(z.string().max(64)).max(CLARIFICATION_CATEGORIES.length),
  })
  .strict();

export type DraftReviewInput = z.infer<typeof draftReviewInput>;

export type StoredReview = {
  readonly id: string;
  readonly baseRevision: number;
  readonly intent: ReviewIntent;
  readonly patch: ReviewPatch | null;
  readonly clarifications: readonly ClarificationCategory[];
  readonly questions: readonly string[];
};

export type DraftReviewResult =
  | { readonly recorded: true; readonly review: StoredReview }
  | { readonly recorded: false; readonly problem: PatchProblem; readonly questions: readonly string[] };

// The checks that need no request: declared intent against the patch and the
// clarification categories. Invalid classification is rejected here, before any
// domain write.
export function intentProblem(input: {
  readonly intent: ReviewIntent;
  readonly patch: ReviewPatch | null;
  readonly clarifications: readonly string[];
}): PatchProblem | null {
  const { unsupported } = parseClarifications(input.clarifications);

  if (unsupported.length > 0) return "unsupported_clarification";

  if (input.intent === "question" || input.intent === "unknown") {
    if (input.patch && hasPatchFields(input.patch)) return "patch_on_question";
    if (input.clarifications.length === 0) return "missing_clarification";
    return null;
  }

  if (!input.patch || !hasPatchFields(input.patch)) return "empty_patch";
  return null;
}

// The pending review the requester sees: its authored questions in the request's
// language.
export function storedReview(
  row: { id: string; base_revision: number; intent: string; patch: ReviewPatch | null; clarifications: string[] },
  language: RequestLanguage,
): StoredReview {
  const clarifications = parseClarifications(row.clarifications).categories;
  return {
    baseRevision: row.base_revision,
    clarifications,
    id: row.id,
    intent: row.intent as ReviewIntent,
    patch: row.patch,
    questions: clarifications.map((category) => clarificationQuestion(category, language)),
  };
}

// request.draft_review: the requester tool's write. The fence (the session's
// current generation) is passed in and rechecked under the request lock.
export function draftReviewCommand(
  fence: (tx: Transaction, requestId: string) => Promise<void> = async () => {},
): CommandDefinition<DraftReviewInput, DraftReviewResult> {
  return {
    input: draftReviewInput,
    operation: DRAFT_REVIEW_OPERATION,
    async run(tx, context) {
      const request = await lockRequester(tx, context);
      await fence(tx, request.id);

      const language = requestLanguage(request.details);
      const { input } = context;
      const reject = (problem: PatchProblem): DraftReviewResult => ({ problem, questions: [], recorded: false });
      const declared = intentProblem(input);

      if (declared) return reject(declared);
      if (request.state === "awaiting_host_approval") return reject("awaiting_host_approval");

      const patch = input.intent === "question" || input.intent === "unknown" ? null : input.patch;

      if (patch) {
        const problem = checkWindows(request.details, patch, await clock(tx)) ?? contactProblem(patch, { draft: true });
        if (problem) return reject(problem);
      }

      const { categories } = parseClarifications(input.clarifications);

      await tx`
        update app.request_reviews set state = 'superseded', resolved_at = now()
        where request_id = ${request.id} and state = 'pending'
      `;
      const [row] = await tx<{ base_revision: number; clarifications: string[]; id: string; intent: string; patch: ReviewPatch | null }[]>`
        insert into app.request_reviews (request_id, base_revision, intent, patch, clarifications)
        values (${request.id}, ${request.revision}, ${input.intent},
                ${patch ? tx.json(patch as Parameters<typeof tx.json>[0]) : null}, ${categories})
        returning id, base_revision, intent, patch, clarifications
      `;

      return { recorded: true, review: storedReview(row!, language) };
    },
  };
}

// ---------------------------------------------------------------------------
// request.apply_review and request.dismiss_review

const reviewInput = z.object({ reviewId: z.uuid() }).strict();

export type ReviewDecision = { readonly revision: number; readonly state: RequestState };

async function lockPendingReview(tx: Transaction, requestId: string, reviewId: string) {
  const [review] = await tx<
    { base_revision: number; clarifications: string[]; id: string; intent: string; patch: ReviewPatch | null; state: string }[]
  >`
    select id, base_revision, intent, patch, clarifications, state from app.request_reviews
    where id = ${reviewId} and request_id = ${requestId}
    for update
  `;

  if (!review) throw new CommandError("forbidden");
  // A superseded, applied or dismissed review is stale for this decision.
  if (review.state !== "pending") throw new CommandError("stale_revision");
  return review;
}

// **Apply these details**: at the expected revision, a pending review made at
// that revision, with no clarification left, whose windows still start in the
// future and fit the duration once the lock is held. A rejection preserves the
// pending review and the request; an exact retry returns the saved decision.
export function applyReviewCommand(options: ContactOptions): CommandDefinition<z.infer<typeof reviewInput>, ReviewDecision> {
  return {
    input: reviewInput,
    operation: APPLY_REVIEW_OPERATION,
    async run(tx, context) {
      const request = await lockRequester(tx, context);
      assertRevision(request.revision, context.expectedRevision);

      const review = await lockPendingReview(tx, request.id, context.input.reviewId);

      if (review.base_revision !== request.revision) throw new CommandError("stale_revision");
      if (!review.patch || review.clarifications.length > 0) throw new CommandError("invalid_input");
      if (request.state === "awaiting_host_approval") throw new CommandError("invalid_input");

      const problem = checkWindows(request.details, review.patch, await clock(tx)) ?? contactProblem(review.patch);

      if (problem) {
        throw new CommandError("invalid_input", problem === "started_window" ? { reason: "start_passed" } : undefined);
      }

      const decision = await writeDetails(tx, request, review.patch, options);
      await tx`update app.request_reviews set state = 'applied', resolved_at = now() where id = ${review.id}`;
      return decision;
    },
  };
}

// **Dismiss**: records the pending review as rejected; nothing else changes.
export const dismissReviewCommand: CommandDefinition<z.infer<typeof reviewInput>, ReviewDecision> = {
  input: reviewInput,
  operation: DISMISS_REVIEW_OPERATION,
  async run(tx, context) {
    const request = await lockRequester(tx, context);
    assertRevision(request.revision, context.expectedRevision);

    const review = await lockPendingReview(tx, request.id, context.input.reviewId);
    await tx`update app.request_reviews set state = 'rejected', resolved_at = now() where id = ${review.id}`;
    return { revision: request.revision, state: request.state };
  },
};

// ---------------------------------------------------------------------------
// request.update_details

const updateDetailsInput = z
  .object({ details: localPatchSchema, timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Not a timezone.") })
  .strict();

// **Save details** on the meeting details card: the same validation as a review,
// applied at once. The card's local times are in its display zone. A meeting
// link typed here is the requester's own entry and is not conversation input.
export function updateDetailsCommand(options: ContactOptions): CommandDefinition<z.infer<typeof updateDetailsInput>, ReviewDecision> {
  return {
    input: updateDetailsInput,
    operation: UPDATE_DETAILS_OPERATION,
    async run(tx, context) {
      const request = await lockRequester(tx, context);
      assertRevision(request.revision, context.expectedRevision);

      if (request.state === "awaiting_host_approval") throw new CommandError("invalid_input");

      const converted = storedPatch(context.input.details, context.input.timezone);
      if (!converted.ok || !hasPatchFields(converted.patch)) throw new CommandError("invalid_input");

      const problem = checkWindows(request.details, converted.patch, await clock(tx)) ?? contactProblem(converted.patch);
      if (problem) throw new CommandError("invalid_input", problem === "started_window" ? { reason: "start_passed" } : undefined);

      // Superseded: a pending review was made against the revision this changes.
      await tx`
        update app.request_reviews set state = 'superseded', resolved_at = now()
        where request_id = ${request.id} and state = 'pending'
      `;
      return writeDetails(tx, request, converted.patch, options);
    },
  };
}
