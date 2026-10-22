import { z } from "zod";
import { COMMAND_ERROR_MESSAGES, type CommandErrorCategory } from "../contracts/command-errors";
import { HOST_REQUEST_OPERATIONS } from "../contracts/host-request";
import { type ChatRouteDependencies, chatDependenciesFromEnvironment, json, ndjsonResponse } from "./chat-routes";
import { runCommand } from "./commands";
import { guestDiscussionEvents } from "./guest-conversations";
import { readHostStanding } from "./host-eligibility";
import { hostRequestCommands, listHostRequests, readHostRequest } from "./host-requests";
import { crossSiteRefusal } from "./same-origin";
import { verifiedUserId } from "./supabase-auth";

// Web routes for the host's requests in /app (host-review-and-booking design 3):
//   GET  /api/host/requests                          the inbox
//   GET  /api/host/requests/{requestId}               the host projection
//   POST /api/host/requests/{requestId}/commands      a card's command
//   GET  /api/host/requests/{requestId}/shared        the shared requester
//                                                     conversation, read-only
// Each authenticates the Supabase session and the host's eligibility itself;
// another host's request, a draft and an unknown ID answer the same 404. The
// shared conversation is read through the application with an internal read
// bearer for the requester discussion, and only ever read: nothing here writes
// to it.

type Context = { readonly params: Promise<{ readonly requestId: string }> };

const COMMAND_STATUS: Readonly<Record<CommandErrorCategory, number>> = {
  booking_pending: 409,
  forbidden: 404,
  identity_required: 409,
  internal: 500,
  invalid_input: 400,
  rate_limited: 429,
  request_closed: 409,
  retry_conflict: 409,
  stale_revision: 409,
  unauthenticated: 401,
  unavailable_configuration: 503,
};

function unavailable() {
  return json({ code: "request_unavailable", error: "This request is not available." }, 404);
}

// The eligible host behind the request's Supabase session, or a refusal.
async function hostOf(deps: ChatRouteDependencies, request: Request) {
  const userId = await verifiedUserId(request, deps.auth);
  if (!userId) return { refusal: json({ code: "authentication_required", error: "Sign in to continue." }, 401) };

  const standing = await readHostStanding(deps.db, userId);
  if (!standing.eligible || !standing.hostAccountId) {
    return { refusal: json({ code: "host_ineligible", error: "Hosting is unavailable for this account.", nextAction: standing.nextAction }, 403) };
  }

  return { hostAccountId: standing.hostAccountId };
}

const requestIdSchema = z.uuid();

export function createHostRequestListHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const host = await hostOf(deps, request);
    if (!host.hostAccountId) return host.refusal!;

    return json({ requests: await listHostRequests(deps.db, host.hostAccountId) });
  };
}

export function createHostRequestHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const host = await hostOf(deps, request);
    if (!host.hostAccountId) return host.refusal!;

    const id = requestIdSchema.safeParse((await context.params).requestId);
    const view = id.success ? await readHostRequest(deps.db, host.hostAccountId, id.data) : null;
    return view ? json(view) : unavailable();
  };
}

const commandBody = z.object({
  operation: z.enum(HOST_REQUEST_OPERATIONS),
  expectedRevision: z.number().int().min(1).nullable().optional(),
  retryKey: z.string().min(1).max(200),
  input: z.unknown(),
});

export function createHostRequestCommandHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;

    const host = await hostOf(deps, request);
    if (!host.hostAccountId) return host.refusal!;

    const id = requestIdSchema.safeParse((await context.params).requestId);
    const body = commandBody.safeParse(await request.json().catch(() => null));
    if (!id.success) return unavailable();
    if (!body.success) {
      return json({ error: { category: "invalid_input", message: COMMAND_ERROR_MESSAGES.invalid_input } }, 400);
    }

    const hostAccountId = host.hostAccountId;
    const outcome = await runCommand(
      { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db: deps.db },
      hostRequestCommands()[body.data.operation],
      { expectedRevision: body.data.expectedRevision ?? null, input: body.data.input ?? {}, resourceId: id.data, retryKey: body.data.retryKey },
    );
    const view = await readHostRequest(deps.db, hostAccountId, id.data);

    return outcome.ok
      ? json({ request: view, result: outcome.result }, outcome.replayed ? 200 : 201)
      : json({ error: outcome.error, request: view }, COMMAND_STATUS[outcome.error.category]);
  };
}

export function createHostSharedEventsHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const host = await hostOf(deps, request);
    if (!host.hostAccountId) return host.refusal!;

    const id = requestIdSchema.safeParse((await context.params).requestId);
    const [owned] = id.success
      ? await deps.db<{ id: string }[]>`
          select id from app.requests where id = ${id.data} and host_account_id = ${host.hostAccountId} and state <> 'draft'
        `
      : [];
    if (!owned) return unavailable();

    const url = new URL(request.url);
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    if (!Number.isInteger(cursor) || cursor < 0) return json({ code: "invalid_cursor", error: "The cursor is not valid." }, 400);

    const events = guestDiscussionEvents(deps, { id: owned.id, type: "requester_request" }, cursor, {
      follow: false,
      signal: request.signal,
    });
    let first: IteratorResult<unknown>;

    try {
      first = await events.next();
    } catch {
      // The requester conversation is readable only while the request is open;
      // a closed request shows its status and receipt instead.
      return json({ code: "shared_unavailable", error: "The shared conversation is not available for this request now." }, 409);
    }

    return ndjsonResponse(first, events);
  };
}
