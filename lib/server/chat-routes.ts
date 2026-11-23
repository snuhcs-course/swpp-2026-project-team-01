import { z } from "zod";
import {
  acceptHostMessage,
  agentUrlFromEnvironment,
  ConversationInputError,
  type ConversationDependencies,
  eveRuntime,
  HostRequestNotFoundError,
} from "./conversations";
import { ADMISSION_LIMITED_MESSAGE, AdmissionLimitError } from "./conversation-admission";
import { database } from "./database";
import { HostIneligibleError } from "./host-eligibility";
import { internalSigningKey } from "./internal-bearer";
import { conversationStatus, discussionEvents, recoverDiscussion } from "./recovery";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";

// The HTTP adapter of the host's setup discussion. The web app mounts none of
// these handlers since the host web chat was removed (remove-host-web-chat): a
// host talks to Thyme only in their linked messenger. They stay as the request
// boundary the conversation integration suites drive (admission, cross-site
// refusal, recovery), until those suites move to the conversation functions.
// Each authenticates the Supabase session itself and returns audience-safe JSON;
// nothing here trusts a client-supplied actor, session ID or generation.
// `json`, `authenticatedUserId`, `chatError` and `ndjsonResponse` serve other
// mounted routes.

export type ChatRouteDependencies = ConversationDependencies &
  AppOrigins & {
  readonly auth: SupabaseAuthConfig;
  // How long a followed event stream may stay silent; FOLLOW_IDLE_MS by default.
  readonly followIdleMs?: number;
};

export function chatDependenciesFromEnvironment(): ChatRouteDependencies {
  return {
    ...appOriginsFromEnvironment(),
    auth: supabaseAuthConfigFromEnvironment(),
    db: database(),
    runtime: eveRuntime(agentUrlFromEnvironment()),
    signingKey: internalSigningKey(),
  };
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { headers: { "cache-control": "private, no-store" }, status });
}

// Verifies the access token only; the session proxy has already refreshed it.
export function authenticatedUserId(request: Request, auth: SupabaseAuthConfig) {
  return verifiedUserId(request, auth);
}

export function chatError(error: unknown) {
  // Another host's request, a draft or an unknown one: the same answer.
  if (error instanceof HostRequestNotFoundError) {
    return json({ code: "request_unavailable", error: "This request is not available." }, 404);
  }

  if (error instanceof HostIneligibleError) {
    return json({ code: "host_ineligible", error: "Hosting is unavailable for this account.", nextAction: error.nextAction }, 403);
  }

  // A temporary limit keeps the message unsent in the browser for a later retry.
  if (error instanceof AdmissionLimitError) {
    return Response.json(
      { code: "rate_limited", error: ADMISSION_LIMITED_MESSAGE, retryAfterSeconds: error.retryAfterSeconds },
      { headers: { "cache-control": "private, no-store", "retry-after": String(error.retryAfterSeconds) }, status: 429 },
    );
  }

  if (error instanceof ConversationInputError) {
    const status = { invalid_message: 400, retry_conflict: 409, runtime_unavailable: 503 }[error.code];
    return json({ code: error.code, error: error.message }, status);
  }

  throw error;
}

// These routes serve only the host's setup discussion. A request is discussed in
// the host's linked messenger, never on the web (remove-host-web-chat), so a
// route that names a request is refused rather than answered from setup.
const messageBody = z.object({ clientInputId: z.uuid(), message: z.string() });

export const REQUEST_SCOPE_REFUSAL = {
  code: "request_scope_unsupported",
  error: "Requests are discussed in your linked messenger, not on the web.",
} as const;

function namesRequest(body: unknown) {
  return typeof body === "object" && body !== null && "request" in body;
}

function requestScopeRefused() {
  return json(REQUEST_SCOPE_REFUSAL, 400);
}

// POST /api/chat/messages
export function createMessageHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const userId = await authenticatedUserId(request, deps.auth);

    if (!userId) {
      return json({ code: "authentication_required", error: "Sign in to continue." }, 401);
    }

    const raw = await request.json().catch(() => null);

    if (namesRequest(raw)) return requestScopeRefused();

    const body = messageBody.safeParse(raw);

    if (!body.success) {
      return json({ code: "invalid_message", error: "Send a message with its client input ID." }, 400);
    }

    try {
      const outcome = await acceptHostMessage(deps, userId, body.data);
      return json(outcome, outcome.status === "recovery_required" ? 409 : 202);
    } catch (error) {
      return chatError(error);
    }
  };
}

function unauthenticated() {
  return json({ code: "authentication_required", error: "Sign in to continue." }, 401);
}

// GET /api/chat/state: the discussion's current generation and whether it failed.
export function createStateHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const userId = await authenticatedUserId(request, deps.auth);

    if (!userId) return unauthenticated();

    if (new URL(request.url).searchParams.has("request")) return requestScopeRefused();

    try {
      return json(await conversationStatus(deps.db, userId));
    } catch (error) {
      return chatError(error);
    }
  };
}

// GET /api/chat/events?cursor=N[&follow=1]: the discussion's events from a
// discussion-level cursor as NDJSON, across recovered generations. With follow,
// the stream ends at the current turn's boundary.
export function createEventsHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const userId = await authenticatedUserId(request, deps.auth);

    if (!userId) return unauthenticated();

    const url = new URL(request.url);
    const cursor = Number(url.searchParams.get("cursor") ?? "0");

    if (url.searchParams.has("request")) return requestScopeRefused();

    if (!Number.isInteger(cursor) || cursor < 0) {
      return json({ code: "invalid_cursor", error: "The cursor is not valid." }, 400);
    }

    const events = discussionEvents(deps, userId, request.headers.get("cookie") ?? "", cursor, {
      follow: url.searchParams.get("follow") === "1",
      idleMs: deps.followIdleMs,
      signal: request.signal,
    });
    let first: IteratorResult<unknown>;

    try {
      // Authorization failures surface before the response starts.
      first = await events.next();
    } catch (error) {
      return error instanceof HostIneligibleError || error instanceof HostRequestNotFoundError
        ? chatError(error)
        : json({ code: "unavailable", error: "History is unavailable right now." }, 503);
    }

    return ndjsonResponse(first, events);
  };
}

// An NDJSON response over an event generator whose first item the caller has
// already read (so authorization failures surface before the response starts).
// The same streaming headers eve's own session stream sends, so no proxy
// transforms or holds back the lines of a followed turn; extra headers (such as
// the booking routes' no-referrer and noindex) are added.
export function ndjsonResponse(
  first: IteratorResult<unknown>,
  events: AsyncGenerator<unknown>,
  headers: Readonly<Record<string, string>> = {},
) {
  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(line(first.value));
    },
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(line(next.value));
      } catch {
        // A broken runtime read ends the stream; the client reconnects from its cursor.
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "cache-control": "private, no-store, no-transform",
      "content-type": "application/x-ndjson",
      "x-accel-buffering": "no",
      ...headers,
    },
  });
}

const recoverBody = z.object({ observedGeneration: z.number().int().positive() });

// POST /api/chat/recover: explicit terminal recovery of the observed generation.
export function createRecoverHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const userId = await authenticatedUserId(request, deps.auth);

    if (!userId) return unauthenticated();

    const raw = await request.json().catch(() => null);

    if (namesRequest(raw)) return requestScopeRefused();

    const body = recoverBody.safeParse(raw);

    if (!body.success) {
      return json({ code: "invalid_request", error: "Name the generation to recover." }, 400);
    }

    try {
      const outcome = await recoverDiscussion(deps, userId, request.headers.get("cookie") ?? "", body.data.observedGeneration);
      const status = { not_failed: 409, recovered: 200, stale: 409, unavailable: 503 }[outcome.status];
      return json(outcome, status);
    } catch (error) {
      return chatError(error);
    }
  };
}
