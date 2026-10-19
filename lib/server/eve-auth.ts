import { parseCookieHeader } from "@supabase/ssr";
import { type AuthFn, extractBearerToken, ForbiddenError, UnauthenticatedError } from "eve/channels/auth";
import { type Database, database } from "./database";
import { readHostStanding } from "./host-eligibility";
import { type InternalGrant, internalSigningKey, messageFingerprint, verifyInternalBearer } from "./internal-bearer";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";

// The only entry in the eve channel's auth list (design decision 7). It accepts
// exactly two shapes and never returns null, so the walk cannot fall through:
//   1. an internal bearer the web service signed, on creating a session or
//      sending its current accepted input;
//   2. a Supabase session cookie, on streaming the caller's own indexed session
//      at its discussion's current generation.
// No credential is UnauthenticatedError; every other request is ForbiddenError.
// Route auth runs before eve records or starts anything, so a denial leaves no
// event and no model work.

export type AppAuthDependencies = {
  readonly auth: SupabaseAuthConfig;
  readonly db: Database;
  readonly signingKey: string;
};

type Route =
  | { readonly kind: "create" }
  | { readonly kind: "send"; readonly sessionId: string }
  | { readonly kind: "stream"; readonly sessionId: string }
  | { readonly kind: "other" };

const SESSION_ROUTE = /\/v1\/session(?:\/([^/]+)(\/stream)?)?\/?$/;

function routeOf(request: Request): Route {
  const match = SESSION_ROUTE.exec(new URL(request.url).pathname);

  if (!match) return { kind: "other" };

  const [, sessionId, stream] = match;

  if (request.method === "POST" && !sessionId) return { kind: "create" };
  if (request.method === "POST" && sessionId && !stream) return { kind: "send", sessionId: decodeURIComponent(sessionId) };
  if (request.method === "GET" && sessionId && stream) return { kind: "stream", sessionId: decodeURIComponent(sessionId) };

  return { kind: "other" };
}

function hasSupabaseSession(request: Request) {
  return parseCookieHeader(request.headers.get("cookie") ?? "").some(({ name }) =>
    /^sb-.+-auth-token(\.\d+)?$/.test(name),
  );
}

function forbidden(): never {
  throw new ForbiddenError({ code: "forbidden", message: "Not allowed." });
}

function sessionAuth(principalId: string, attributes: Record<string, string>) {
  return { attributes, authenticator: "findmeatime", issuer: "findmeatime", principalId, principalType: "user" };
}

async function hostIsActive(db: Database, hostAccountId: string) {
  const [row] = await db<{ status: string }[]>`select status from app.host_accounts where id = ${hostAccountId}`;
  return row?.status === "active";
}

// A create is allowed only for the next generation of a discussion that belongs
// to the bearer's principal (or is new).
async function mayCreate(db: Database, grant: Extract<InternalGrant, { kind: "create" }>) {
  const [conflict] = await db<{ found: boolean }[]>`
    select true as found from app.agent_sessions
    where discussion_id = ${grant.discussionId}
      and (generation >= ${grant.generation}
           or principal_type <> ${grant.principal.type} or principal_id <> ${grant.principal.id})
    limit 1
  `;

  if (conflict) return false;
  if (grant.generation === 1) return true;

  const [previous] = await db<{ found: boolean }[]>`
    select true as found from app.agent_sessions
    where discussion_id = ${grant.discussionId} and generation = ${grant.generation - 1}
  `;
  return Boolean(previous);
}

// A send is allowed only for the session's current accepted input, at the
// generation the bearer names, while the session is live.
async function maySend(db: Database, grant: Extract<InternalGrant, { kind: "send" }>, sessionId: string) {
  if (grant.sessionId !== sessionId) return false;

  const [row] = await db<{ found: boolean }[]>`
    select true as found from app.agent_sessions
    where session_id = ${sessionId}
      and discussion_id = ${grant.discussionId}
      and principal_type = ${grant.principal.type} and principal_id = ${grant.principal.id}
      and generation = ${grant.generation}
      and state = 'active'
      and current_input_id = ${grant.inputId}
  `;
  return Boolean(row);
}

// A create never carries a first message: the index row must exist, with its
// accepted input, before any message reaches the session.
async function carriesMessage(request: Request) {
  const body = await request.clone().text();

  if (!body.trim()) return false;

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed.message !== undefined || parsed.inputResponses !== undefined;
  } catch {
    return true;
  }
}

// A send carries exactly the message its bearer was signed for.
async function carriesSignedMessage(request: Request, grant: Extract<InternalGrant, { kind: "send" }>) {
  try {
    const { message } = JSON.parse(await request.clone().text()) as { message?: unknown };
    return typeof message === "string" && messageFingerprint(message) === grant.messageFingerprint;
  } catch {
    return false;
  }
}

async function authorizeBearer(deps: AppAuthDependencies, request: Request, route: Route, token: string) {
  const grant = verifyInternalBearer(token, deps.signingKey);

  if (!grant || grant.principal.type !== "host_account") forbidden();
  if (route.kind === "create" && (await carriesMessage(request))) forbidden();

  const allowed =
    route.kind === "create" && grant.kind === "create"
      ? await mayCreate(deps.db, grant)
      : route.kind === "send" && grant.kind === "send"
        ? (await carriesSignedMessage(request, grant)) && (await maySend(deps.db, grant, route.sessionId))
        : false;

  if (!allowed || !(await hostIsActive(deps.db, grant.principal.id))) forbidden();

  return sessionAuth(grant.principal.id, {
    discussionId: grant.discussionId,
    generation: String(grant.generation),
  });
}

// The browser may stream only its own session at the discussion's current
// generation; a retired generation's history is served by the application.
async function authorizeCookie(deps: AppAuthDependencies, request: Request, sessionId: string) {
  // The access token only: the agent never refreshes a session, so it never
  // spends the refresh token the browser's next request depends on.
  const userId = await verifiedUserId(request, deps.auth);

  if (!userId) {
    throw new UnauthenticatedError({ code: "authentication_required", message: "Sign in to continue." });
  }

  const standing = await readHostStanding(deps.db, userId);

  if (!standing.eligible || !standing.hostAccountId) forbidden();

  const [row] = await deps.db<{ discussion_id: string; generation: number }[]>`
    select s.discussion_id, s.generation
    from app.agent_sessions s
    where s.session_id = ${sessionId}
      and s.principal_type = 'host_account' and s.principal_id = ${standing.hostAccountId}
      and s.state in ('active', 'failed')
      and s.generation = (select max(generation) from app.agent_sessions where discussion_id = s.discussion_id)
  `;

  if (!row) forbidden();

  return sessionAuth(standing.hostAccountId, {
    discussionId: row.discussion_id,
    generation: String(row.generation),
  });
}

export function createAppAuth(load: () => AppAuthDependencies): AuthFn<Request> {
  return async (request) => {
    const token = extractBearerToken(request.headers.get("authorization"));
    const cookie = hasSupabaseSession(request);

    if (!token && !cookie) {
      throw new UnauthenticatedError({ code: "authentication_required", message: "Sign in to continue." });
    }

    const route = routeOf(request);
    const deps = load();

    if (token) {
      if (route.kind !== "create" && route.kind !== "send") forbidden();
      return authorizeBearer(deps, request, route, token);
    }

    if (route.kind !== "stream") forbidden();
    return authorizeCookie(deps, request, route.sessionId);
  };
}

export const appAuth: AuthFn<Request> = createAppAuth(() => ({
  auth: supabaseAuthConfigFromEnvironment(),
  db: database(),
  signingKey: internalSigningKey(),
}));
