import { randomInt, randomUUID } from "node:crypto";
import { hashBookingId } from "../../../lib/server/booking-links";
import type { ConversationRuntime } from "../../../lib/server/conversations";
import type { Database } from "../../../lib/server/database";
import { sessionIdHash } from "../../../lib/server/model-limits";
import { createRequestStartHandler, type RequesterRouteDependencies } from "../../../lib/server/requester-routes";
import { makeHostReady, newHostAccount } from "./ready-host";
import { testTokenKey } from "./requests";

// Shared helpers for the guest suites: a ready public host, a
// source address of the suite's own (so per-source bounds never meet another
// test's), route dependencies with a recording runtime in place of eve, and
// requests shaped the way the browser sends them.

export const ORIGIN = "http://localhost:3000";
export const SIGNING_KEY = "guest-suite-signing-key-0123456789abcdef";

export function sourceAddress() {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

export async function readyHost(db: Database, options: { displayName?: string } = {}) {
  const hostAccountId = await newHostAccount(db);
  const { displayName, handle } = await makeHostReady(db, hostAccountId, options);
  return { displayName, handle, hostAccountId };
}

export type Sent = { readonly sessionId: string; readonly message: string };

export function recordingRuntime(sent: Sent[] = []): ConversationRuntime {
  return {
    createSession: async () => `wrun_${randomUUID()}`,
    readEvents: () => (async function* () {})(),
    readRecordedEvents: () => (async function* () {})(),
    sendMessage: async (sessionId, _bearer, message) => {
      sent.push({ message, sessionId });
    },
  };
}

export function guestDependencies(db: Database, overrides: Partial<RequesterRouteDependencies> = {}): RequesterRouteDependencies {
  return {
    admission: { serviceKey: `test:${randomUUID()}` },
    appOrigin: ORIGIN,
    // Suites create many requests; only the bound tests keep the real numbers.
    creationLimits: { perSourceDay: Number.POSITIVE_INFINITY, perSourceHour: Number.POSITIVE_INFINITY, serviceDay: Number.POSITIVE_INFINITY },
    db,
    runtime: recordingRuntime(),
    signingKey: SIGNING_KEY,
    tokenKey: () => testTokenKey,
    ...overrides,
  };
}

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

export function call<P>(
  handler: Handler<P>,
  params: P,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; source?: string } = {},
) {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  return handler(
    new Request(`${ORIGIN}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers: {
        ...(method === "POST" ? { "content-type": "application/json", origin: ORIGIN } : {}),
        "x-forwarded-for": options.source ?? sourceAddress(),
        ...options.headers,
      },
      method,
    }),
    { params: Promise.resolve(params) },
  );
}

// A guest's first message on the public page, as the browser sends it: it
// starts a draft request with the tab's nonce.
export function startDraft(
  deps: RequesterRouteDependencies,
  handle: string,
  text: string,
  options: { readonly nonce?: string; readonly source?: string; readonly clientInputId?: string; readonly language?: "en" | "ko"; readonly timezone?: string } = {},
) {
  return call(createRequestStartHandler(() => deps), {}, "/api/requests/start", {
    body: {
      clientInputId: options.clientInputId ?? randomUUID(),
      handle,
      language: options.language ?? "en",
      message: text,
      nonce: options.nonce ?? randomUUID(),
      timezone: options.timezone ?? "Asia/Seoul",
    },
    source: options.source,
  });
}

// Starts a draft and returns its request and booking identifier.
export async function startedDraft(deps: RequesterRouteDependencies, handle: string, options: Parameters<typeof startDraft>[3] = {}) {
  const response = await startDraft(deps, handle, "I'd like to talk about a research collaboration.", options);
  if (response.status !== 202) throw new Error(`Starting a draft answered ${response.status}.`);
  const { bookingId } = (await response.json()) as { bookingId: string };
  const [row] = await deps.db<{ discussion_id: string; id: string }[]>`
    select r.id, d.id as discussion_id from app.requests r
    join app.booking_links l on l.request_id = r.id
    join app.discussions d on d.principal_type = 'requester_request' and d.principal_id = r.id
    where l.link_hash = ${hashBookingId(bookingId)}
  `;
  return { bookingId, discussionId: row!.discussion_id, requestId: row!.id };
}

// Indexes a live session for a request's discussion, as the message route does
// on first use, with a current input, so tool fences and model attribution find it.
export async function indexRequestSession(db: Database, requestId: string) {
  const [discussion] = await db<{ id: string }[]>`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('requester_request', ${requestId}, 'requester')
    on conflict (principal_type, principal_id, audience) do update set audience = excluded.audience
    returning id
  `;
  const inputId = randomUUID();
  // The message route may have indexed one already; its live generation is used.
  const [existing] = await db<{ session_id: string }[]>`
    update app.agent_sessions set current_input_id = ${inputId}
    where discussion_id = ${discussion!.id} and state = 'active'
    returning session_id
  `;

  if (existing) return { discussionId: discussion!.id, inputId, key: sessionIdHash(existing.session_id), sessionId: existing.session_id };

  const sessionId = `wrun_${randomUUID()}`;
  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, current_input_id)
    values
      (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'requester_request', ${requestId}, 1, 'test', ${inputId})
  `;
  return { discussionId: discussion!.id, inputId, key: sessionIdHash(sessionId), sessionId };
}
