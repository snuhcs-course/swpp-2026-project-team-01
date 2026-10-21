import { parseCookieHeader } from "@supabase/ssr";
import { type AuthFn, extractBearerToken, ForbiddenError, localDev, UnauthenticatedError } from "eve/channels/auth";
import { type Database, database } from "./database";
import { deploymentEnvironment } from "./deployment";
import { readHostStanding } from "./host-eligibility";
import { type InternalGrant, internalSigningKey, messageFingerprint, verifyInternalBearer } from "./internal-bearer";
import type { Principal } from "./model-limits";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";

// The only entry in the eve channel's auth list (design decision 7). It accepts
// exactly two shapes and never returns null, so the walk cannot fall through:
//   1. an internal bearer the application signed, on creating a session,
//      sending its current accepted input, or reading the one session it names,
//      for a host, a requester (`request:{id}`, audience requester) or an
//      anonymous intake (`intake:{id}`, audience public_intake);
//   2. a Supabase session cookie, on streaming the caller's own indexed session
//      at its discussion's current generation (hosts only: a requester's browser
//      holds no cookie and never calls /eve/v1; its application routes read with
//      a bearer on its behalf).
// No credential is UnauthenticatedError; every other request is ForbiddenError.
// The session attributes name the discussion's audience, generation and ID; the
// setup tools and instructions resolve only for the host setup audience, the
// intake tools only for public_intake.
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

  const [, encoded, stream] = match;
  let sessionId: string | undefined;

  try {
    sessionId = encoded === undefined ? undefined : decodeURIComponent(encoded);
  } catch {
    // A malformed escape names no session.
    return { kind: "other" };
  }

  if (request.method === "POST" && !sessionId) return { kind: "create" };
  if (request.method === "POST" && sessionId && !stream) return { kind: "send", sessionId };
  if (request.method === "GET" && sessionId && stream) return { kind: "stream", sessionId };

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

export const HOST_SETUP_AUDIENCE = "host_setup";
export const REQUESTER_AUDIENCE = "requester";
export const PUBLIC_INTAKE_AUDIENCE = "public_intake";

// The eve principal of each discussion audience (agent configuration: audiences
// and sessions). A host is its account ID; a requester is `request:{requestId}`
// and an anonymous intake `intake:{intakeId}`, so a tool can never mistake one
// kind of principal for another.
export function sessionPrincipalId(principal: Principal) {
  if (principal.type === "requester_request") return `request:${principal.id}`;
  if (principal.type === "public_intake") return `intake:${principal.id}`;
  return principal.id;
}

function audienceOf(principal: Principal) {
  if (principal.type === "requester_request") return REQUESTER_AUDIENCE;
  if (principal.type === "public_intake") return PUBLIC_INTAKE_AUDIENCE;
  return HOST_SETUP_AUDIENCE;
}

function sessionAuth(principal: Principal, discussionId: string, generation: number) {
  const subject: Record<string, string> =
    principal.type === "requester_request"
      ? { requestId: principal.id }
      : principal.type === "public_intake"
        ? { intakeId: principal.id }
        : {};

  return {
    attributes: { audience: audienceOf(principal), discussionId, generation: String(generation), ...subject },
    authenticator: "findmeatime",
    issuer: "findmeatime",
    principalId: sessionPrincipalId(principal),
    principalType: "user",
  };
}

// A requester or intake principal reaches only its own discussion of its own
// audience, while it is open: a request whose link and lifetime are current, an
// intake that has not continued or expired. Reading an intake's session stays
// allowed once its request exists, so the application can keep its transcript,
// but only while that request is open and its link unexpired.
async function guestMayUse(db: Database, principal: Principal, discussionId: string, kind: InternalGrant["kind"]) {
  if (principal.type === "requester_request") {
    const [row] = await db<{ allowed: boolean }[]>`
      select r.closed_at is null and r.expires_at > now() and l.expires_at > now() as allowed
      from app.discussions d
      join app.requests r on r.id = d.principal_id
      join app.booking_links l on l.request_id = r.id
      where d.id = ${discussionId} and d.principal_type = 'requester_request' and d.principal_id = ${principal.id}
        and d.audience = ${REQUESTER_AUDIENCE}
    `;
    return Boolean(row?.allowed);
  }

  const [row] = await db<{ open: boolean; continued: boolean }[]>`
    select i.closed_at is null and i.expires_at > now() as open,
           coalesce(r.closed_at is null and r.expires_at > now() and l.expires_at > now(), false) as continued
    from app.discussions d
    join app.intakes i on i.id = d.principal_id and i.discussion_id = d.id
    left join app.requests r on r.id = i.request_id
    left join app.booking_links l on l.request_id = r.id
    where d.id = ${discussionId} and d.principal_type = 'public_intake' and d.principal_id = ${principal.id}
      and d.audience = ${PUBLIC_INTAKE_AUDIENCE}
  `;
  return Boolean(row && (row.open || (kind === "read" && row.continued)));
}

// A host principal may reach only its own host setup discussion; any other
// audience, or a discussion that is missing or someone else's, is refused.
async function isHostSetupDiscussion(db: Database, discussionId: string, hostAccountId: string) {
  const [row] = await db<{ audience: string }[]>`
    select audience from app.discussions
    where id = ${discussionId} and principal_type = 'host_account' and principal_id = ${hostAccountId}
  `;
  return row?.audience === HOST_SETUP_AUDIENCE;
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

// A read is allowed only for the session the bearer names, at its generation,
// while the session is not retired: the same sessions a browser may stream.
async function mayRead(db: Database, grant: Extract<InternalGrant, { kind: "read" }>, sessionId: string) {
  if (grant.sessionId !== sessionId) return false;

  const [row] = await db<{ found: boolean }[]>`
    select true as found from app.agent_sessions
    where session_id = ${sessionId}
      and discussion_id = ${grant.discussionId}
      and principal_type = ${grant.principal.type} and principal_id = ${grant.principal.id}
      and generation = ${grant.generation}
      and state in ('active', 'failed')
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

  if (!grant) forbidden();
  if (route.kind === "create" && (await carriesMessage(request))) forbidden();

  const allowed =
    route.kind === "create" && grant.kind === "create"
      ? await mayCreate(deps.db, grant)
      : route.kind === "send" && grant.kind === "send"
        ? (await carriesSignedMessage(request, grant)) && (await maySend(deps.db, grant, route.sessionId))
        : route.kind === "stream" && grant.kind === "read"
          ? await mayRead(deps.db, grant, route.sessionId)
          : false;

  if (!allowed) forbidden();

  if (grant.principal.type === "host_account") {
    if (
      !(await hostIsActive(deps.db, grant.principal.id)) ||
      !(await isHostSetupDiscussion(deps.db, grant.discussionId, grant.principal.id))
    ) {
      forbidden();
    }
  } else if (!(await guestMayUse(deps.db, grant.principal, grant.discussionId, grant.kind))) {
    forbidden();
  }

  return sessionAuth(grant.principal, grant.discussionId, grant.generation);
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
    join app.discussions d on d.id = s.discussion_id
      and d.principal_type = 'host_account' and d.principal_id = s.principal_id
      and d.audience = ${HOST_SETUP_AUDIENCE}
    where s.session_id = ${sessionId}
      and s.principal_type = 'host_account' and s.principal_id = ${standing.hostAccountId}
      and s.state in ('active', 'failed')
      and s.generation = (select max(generation) from app.agent_sessions where discussion_id = s.discussion_id)
  `;

  if (!row) forbidden();

  return sessionAuth({ id: standing.hostAccountId, type: "host_account" }, row.discussion_id, row.generation);
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
      if (route.kind === "other") forbidden();
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

// ---------------------------------------------------------------------------
// Evals

// The header an eval names its seeded request with when it creates a session.
export const EVAL_REQUEST_HEADER = "x-fmat-eval-request";

// Requester evals only (evals/): `eve eval` boots its own `eve dev` and sends no
// credential, and a stubbed session needs a caller allowed to stub tools. With
// FMAT_EVAL_AUDIENCE=requester in the environment of a process with no Vercel
// metadata, and only while it is an `eve dev` server (localDev), a request that
// carries no bearer and no Supabase cookie becomes the requester principal of
// a request the eval seeded in the local database: named by EVAL_REQUEST_HEADER
// on create, and by the session's index row afterwards; the agent info route,
// which the runner reads first, gets eve's synthetic local caller. Anything else
// skips to appAuth, so deployments, `eve start` and ordinary local runs are
// unchanged.
export function createEvalRequesterAuth(
  load: () => Pick<AppAuthDependencies, "db">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthFn<Request> {
  const local = localDev();

  return async (request) => {
    if (env.FMAT_EVAL_AUDIENCE !== "requester" || deploymentEnvironment(env) !== "local") return null;
    if (extractBearerToken(request.headers.get("authorization")) || hasSupabaseSession(request)) return null;
    const caller = await local(request);
    if (!caller) return null;

    const path = new URL(request.url).pathname;
    // The runner reads the agent's info before it starts, which names no
    // session, and checks a session's stub matches after it ends.
    if (request.method === "GET" && /\/v1\/info\/?$/.test(path)) return caller;

    const stubs = request.method === "GET" ? /\/v1\/session\/([^/]+)\/stubs\/?$/.exec(path) : null;
    const route: Route = stubs ? { kind: "stream", sessionId: decodeURIComponent(stubs[1]!) } : routeOf(request);

    const { db } = load();
    const named = request.headers.get(EVAL_REQUEST_HEADER);
    const [row] =
      route.kind === "create" && named && /^[0-9a-f-]{36}$/.test(named)
        ? await db<{ discussion_id: string; generation: number; request_id: string }[]>`
            select d.id as discussion_id, 1 as generation, d.principal_id as request_id from app.discussions d
            where d.principal_type = 'requester_request' and d.principal_id = ${named} and d.audience = ${REQUESTER_AUDIENCE}
          `
        : route.kind === "send" || route.kind === "stream"
          ? await db<{ discussion_id: string; generation: number; request_id: string }[]>`
              select discussion_id, generation, principal_id as request_id from app.agent_sessions
              where session_id = ${route.sessionId} and principal_type = 'requester_request'
            `
          : [];

    if (!row) return null;

    return {
      ...sessionAuth({ id: row.request_id, type: "requester_request" }, row.discussion_id, row.generation),
      allowToolStubs: true,
    };
  };
}

export const evalRequesterAuth: AuthFn<Request> = createEvalRequesterAuth(() => ({ db: database() }));
