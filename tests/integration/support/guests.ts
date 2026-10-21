import { randomInt, randomUUID } from "node:crypto";
import type { ConversationRuntime } from "../../../lib/server/conversations";
import type { Database } from "../../../lib/server/database";
import type { IntakeRouteDependencies } from "../../../lib/server/intake-routes";
import { sessionIdHash } from "../../../lib/server/model-limits";
import { makeHostReady, newHostAccount } from "./ready-host";
import { testTokenKey } from "./requests";

// Shared helpers for the requester and intake suites: a ready public host, a
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

export function guestDependencies(db: Database, overrides: Partial<IntakeRouteDependencies> = {}): IntakeRouteDependencies {
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

// Indexes a live session for an intake's discussion, as the message route does
// on first use, so tool fences and model attribution find it.
export async function indexIntakeSession(db: Database, intakeId: string) {
  const [intake] = await db<{ discussion_id: string }[]>`select discussion_id from app.intakes where id = ${intakeId}`;
  const inputId = randomUUID();
  // The message route may have indexed one already; its live generation is used.
  const [existing] = await db<{ session_id: string }[]>`
    update app.agent_sessions set current_input_id = ${inputId}
    where discussion_id = ${intake!.discussion_id} and state = 'active'
    returning session_id
  `;

  if (existing) return { inputId, key: sessionIdHash(existing.session_id), sessionId: existing.session_id };

  const sessionId = `wrun_${randomUUID()}`;
  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, current_input_id)
    values
      (${sessionId}, ${sessionIdHash(sessionId)}, ${intake!.discussion_id}, 'public_intake', ${intakeId}, 1, 'test', ${inputId})
  `;
  return { inputId, key: sessionIdHash(sessionId), sessionId };
}
