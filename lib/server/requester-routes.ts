import { z } from "zod";
import { type ClarificationCategory, isActionableRequestState, type RequestDetails, type RequestState, type ReviewIntent } from "../contracts/request";
import type { OpenRequesterView, RequesterView } from "../contracts/requester-view";
import { findRequestByBookingId } from "./booking-links";
import { ndjsonResponse } from "./chat-routes";
import { type Actor, type CommandDefinition, runCommand } from "./commands";
import { COMMAND_STATUS, REQUESTER_HEADERS, requesterJson, requestUnavailable } from "./confirmation-routes";
import {
  type ConfirmationLimits,
  readConfirmationStatus,
  resendConfirmationCommand,
} from "./contact-confirmation";
import { ADMISSION_LIMITED_MESSAGE, AdmissionLimitError } from "./conversation-admission";
import {
  agentUrlFromEnvironment,
  ConversationClosedError,
  type ConversationDependencies,
  ConversationInputError,
  eveRuntime,
} from "./conversations";
import { database, type Database, type Queryable } from "./database";
import {
  acceptGuestMessage,
  type GuestConversationDependencies,
  type GuestPrincipal,
  guestConversationStatus,
  guestDiscussionEvents,
} from "./guest-conversations";
import { IntakeLimitError } from "./intakes";
import { internalSigningKey } from "./internal-bearer";
import { withdrawRequestCommand } from "./request-lifecycle";
import {
  disconnectCalendarCommand,
  listRequesterCalendars,
  readRequesterConnection,
  selectCalendarsCommand,
  useGoogleEmailCommand,
} from "./requester-grants";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The requester's application routes under /api/requests/{bookingId}/ (design
// decision 2). The booking identifier in the path is the only credential: it is
// looked up by hash, and a malformed, unknown or expired one, or a closed
// request where the route needs an open one, gets the same generic answer. The
// requester's browser never calls /eve/v1: history and the live stream are read
// here with an internal bearer, the requester principal (`request:{id}`,
// audience requester) and its own discussion only. Every response sends
// Referrer-Policy: no-referrer, X-Robots-Tag: noindex and Cache-Control:
// no-store, and nothing here logs the path.

export type RequesterRouteDependencies = ConversationDependencies &
  GuestConversationDependencies &
  AppOrigins & {
    readonly tokenKey: () => TokenKey;
    readonly confirmationLimits?: Partial<ConfirmationLimits>;
    readonly followIdleMs?: number;
  };

export function requesterRouteDependenciesFromEnvironment(): RequesterRouteDependencies {
  return {
    ...appOriginsFromEnvironment(),
    db: database(),
    runtime: eveRuntime(agentUrlFromEnvironment()),
    signingKey: internalSigningKey(),
    tokenKey: tokenKeyFromEnvironment,
  };
}

type Context = { readonly params: Promise<{ readonly bookingId: string }> };

// The open request the identifier names, or null (unknown, malformed, expired
// link, or a closed or expired request).
export async function openRequester(db: Database, bookingId: string): Promise<GuestPrincipal | null> {
  const link = await findRequestByBookingId(db, bookingId);

  if (!link || link.expired) return null;

  const [request] = await db<{ open: boolean }[]>`
    select closed_at is null and expires_at > now() as open from app.requests where id = ${link.requestId}
  `;
  return request?.open ? { id: link.requestId, type: "requester_request" } : null;
}

// ---------------------------------------------------------------------------
// The requester view

export async function readRequesterView(
  db: Queryable,
  requestId: string,
  options: { readonly confirmationLimits?: Partial<ConfirmationLimits> } = {},
): Promise<RequesterView | null> {
  const [row] = await db<
    {
      closed: boolean;
      confirmed: boolean;
      contact_email: string;
      details: Partial<RequestDetails>;
      display_name: string | null;
      expires_at: Date;
      handle: string | null;
      has_intake: boolean;
      requester_name: string;
      revision: number;
      state: RequestState;
    }[]
  >`
    select r.state, r.revision, r.details, r.requester_name, r.contact_email, r.expires_at,
           (r.closed_at is not null or r.expires_at <= now()) as closed,
           coalesce(lower(r.contact_confirmed_email) = lower(r.contact_email), false) as confirmed,
           s.settings ->> 'displayName' as display_name, h.handle,
           exists (select 1 from app.intakes i where i.request_id = r.id) as has_intake
    from app.requests r
    left join app.host_settings s on s.host_account_id = r.host_account_id
    left join app.host_handles h on h.host_account_id = r.host_account_id and h.released_at is null
    where r.id = ${requestId}
  `;

  if (!row) return null;

  const host = { displayName: row.display_name ?? "Your host", handle: row.handle };

  // An actionable request past its expiry reads as expired even before the
  // sweep closes it, as every command treats it.
  if (row.closed) {
    return { host, open: false, request: { state: isActionableRequestState(row.state) ? "expired" : row.state } };
  }

  const [review] = await db<
    { base_revision: number; clarifications: string[]; id: string; intent: string; patch: Partial<RequestDetails> | null }[]
  >`
    select id, base_revision, intent, patch, clarifications from app.request_reviews
    where request_id = ${requestId} and state = 'pending'
  `;
  const view: OpenRequesterView = {
    confirmation: await readConfirmationStatus(db, requestId, options.confirmationLimits),
    connection: await readRequesterConnection(db, requestId),
    contact: { confirmed: row.confirmed, email: row.contact_email, name: row.requester_name },
    conversation: await guestConversationStatus(db, { id: requestId, type: "requester_request" }),
    hasIntakeTranscript: row.has_intake,
    host,
    open: true,
    pendingReview: review
      ? {
          baseRevision: review.base_revision,
          clarifications: review.clarifications as ClarificationCategory[],
          id: review.id,
          intent: review.intent as ReviewIntent,
          patch: review.patch,
        }
      : null,
    request: { details: row.details, expiresAt: row.expires_at.toISOString(), revision: row.revision, state: row.state },
  };

  return view;
}

// GET /api/requests/{bookingId}/state: the open view, the closed status only, or
// the generic unavailable answer.
export function createRequesterStateHandler(load: () => RequesterRouteDependencies = requesterRouteDependenciesFromEnvironment) {
  return async (_request: Request, context: Context) => {
    const deps = load();
    const link = await findRequestByBookingId(deps.db, (await context.params).bookingId);

    if (!link || link.expired) return requestUnavailable();

    const view = await readRequesterView(deps.db, link.requestId, { confirmationLimits: deps.confirmationLimits });
    return view ? requesterJson(view) : requestUnavailable();
  };
}

// ---------------------------------------------------------------------------
// Conversation

export function guestError(error: unknown) {
  if (error instanceof AdmissionLimitError) {
    return Response.json(
      { code: "rate_limited", error: ADMISSION_LIMITED_MESSAGE, retryAfterSeconds: error.retryAfterSeconds },
      { headers: { ...REQUESTER_HEADERS, "retry-after": String(error.retryAfterSeconds) }, status: 429 },
    );
  }

  if (error instanceof IntakeLimitError) {
    return requesterJson(
      {
        code: "intake_limit",
        error: "This conversation has reached its message limit. Continue with or without Google to keep going.",
      },
      429,
    );
  }

  if (error instanceof ConversationClosedError) {
    return requesterJson({ code: "closed", error: "This conversation is closed." }, 409);
  }

  if (error instanceof ConversationInputError) {
    const status = { invalid_message: 400, retry_conflict: 409, runtime_unavailable: 503 }[error.code];
    return requesterJson({ code: error.code, error: error.message }, status);
  }

  throw error;
}

const messageBody = z.object({ clientInputId: z.uuid(), message: z.string() });

// POST /api/requests/{bookingId}/messages
export function createRequesterMessageHandler(load: () => RequesterRouteDependencies = requesterRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const principal = await openRequester(deps.db, (await context.params).bookingId);

    if (!principal) return requestUnavailable();

    const body = messageBody.safeParse(await request.json().catch(() => null));

    if (!body.success) return requesterJson({ code: "invalid_message", error: "Send a message with its client input ID." }, 400);

    try {
      const outcome = await acceptGuestMessage(deps, principal, body.data);
      return requesterJson(outcome, outcome.status === "recovery_required" ? 409 : 202);
    } catch (error) {
      return guestError(error);
    }
  };
}

const STREAM_HEADERS = { "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } as const;

// Streams a guest discussion's events as NDJSON from a cursor.
export async function guestEventsResponse(
  deps: Pick<RequesterRouteDependencies, "db" | "runtime" | "signingKey" | "followIdleMs">,
  principal: GuestPrincipal,
  request: Request,
) {
  const url = new URL(request.url);
  const cursor = Number(url.searchParams.get("cursor") ?? "0");

  if (!Number.isInteger(cursor) || cursor < 0) {
    return requesterJson({ code: "invalid_cursor", error: "The cursor is not valid." }, 400);
  }

  const events = guestDiscussionEvents(deps, principal, cursor, {
    follow: url.searchParams.get("follow") === "1",
    idleMs: deps.followIdleMs,
    signal: request.signal,
  });
  let first: IteratorResult<unknown>;

  try {
    first = await events.next();
  } catch {
    return requesterJson({ code: "unavailable", error: "History is unavailable right now." }, 503);
  }

  return ndjsonResponse(first, events, STREAM_HEADERS);
}

// GET /api/requests/{bookingId}/events?cursor=N[&follow=1]
export function createRequesterEventsHandler(load: () => RequesterRouteDependencies = requesterRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const principal = await openRequester(deps.db, (await context.params).bookingId);

    if (!principal) return requestUnavailable();
    return guestEventsResponse(deps, principal, request);
  };
}

// GET /api/requests/{bookingId}/intake: the read-only transcript of the public
// intake the request came from, served from that intake discussion's record.
export function createIntakeTranscriptHandler(load: () => RequesterRouteDependencies = requesterRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const principal = await openRequester(deps.db, (await context.params).bookingId);

    if (!principal) return requestUnavailable();

    const [intake] = await deps.db<{ id: string }[]>`select id from app.intakes where request_id = ${principal.id}`;

    if (!intake) return ndjsonResponse({ done: true, value: undefined }, (async function* () {})(), STREAM_HEADERS);

    const url = new URL(request.url);
    url.searchParams.delete("follow");
    return guestEventsResponse(deps, { id: intake.id, type: "public_intake" }, new Request(url, { signal: request.signal }));
  };
}

// ---------------------------------------------------------------------------
// Commands

// A requester command of any input and result, as the registry holds it.
export type RequesterCommand = CommandDefinition<unknown, unknown>;

function registered<Input, Result>(command: CommandDefinition<Input, Result>): [string, RequesterCommand] {
  return [command.operation, command as unknown as RequesterCommand];
}

// The requester commands by operation. Lane D adds its card commands here.
export function requesterCommands(
  deps: Pick<RequesterRouteDependencies, "appOrigin" | "confirmationLimits" | "tokenKey">,
): Readonly<Record<string, RequesterCommand>> {
  return Object.fromEntries([
    registered(withdrawRequestCommand),
    registered(useGoogleEmailCommand),
    registered(disconnectCalendarCommand),
    registered(selectCalendarsCommand),
    registered(resendConfirmationCommand({ limits: deps.confirmationLimits, origin: deps.appOrigin, tokenKey: deps.tokenKey() })),
  ]);
}

const commandBody = z.object({
  operation: z.string().min(1).max(100),
  input: z.unknown().optional(),
  expectedRevision: z.number().int().positive().nullable().optional(),
  retryKey: z.string().min(1).max(200),
});

// POST /api/requests/{bookingId}/commands: { operation, input, expectedRevision, retryKey }.
// A closed request answers request_closed with its current status.
export function createRequesterCommandHandler(load: () => RequesterRouteDependencies = requesterRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const link = await findRequestByBookingId(deps.db, (await context.params).bookingId);

    if (!link || link.expired) return requestUnavailable();

    const body = commandBody.safeParse(await request.json().catch(() => null));

    if (!body.success) return requesterJson({ code: "invalid_request", error: "Send an operation and a retry key." }, 400);

    const command = requesterCommands(deps)[body.data.operation];

    if (!command) return requesterJson({ code: "invalid_request", error: "This action is not available." }, 400);

    const actor: Actor = { id: link.requestId, kind: "requester_request" };
    const outcome = await runCommand({ authenticate: async () => actor, db: deps.db }, command, {
      expectedRevision: body.data.expectedRevision ?? null,
      input: body.data.input ?? {},
      resourceId: link.requestId,
      retryKey: body.data.retryKey,
    });

    if (!outcome.ok) {
      if (outcome.error.category === "forbidden" || outcome.error.category === "unauthenticated") return requestUnavailable();

      const view = outcome.error.category === "request_closed" ? await readRequesterView(deps.db, link.requestId) : null;
      return requesterJson(
        view ? { ...outcome, status: view.request.state } : outcome,
        COMMAND_STATUS[outcome.error.category],
      );
    }

    return requesterJson(outcome, 200);
  };
}

// GET /api/requests/{bookingId}/calendars: the requester's own calendar list for
// the selection card, read live with this request's grant only.
export function createRequesterCalendarsHandler(load: () => RequesterRouteDependencies = requesterRouteDependenciesFromEnvironment) {
  return async (_request: Request, context: Context) => {
    const deps = load();
    const principal = await openRequester(deps.db, (await context.params).bookingId);

    if (!principal) return requestUnavailable();

    const calendars = await listRequesterCalendars(deps.db, [deps.tokenKey()], principal.id);
    return calendars
      ? requesterJson({ calendars })
      : requesterJson({ code: "calendar_unavailable", error: "Your calendar list could not be read right now." }, 503);
  };
}
