import { createHash, randomBytes } from "node:crypto";
import { parseCookieHeader } from "@supabase/ssr";
import { type AgentRole, type AgentScope, roleScopes, SCOPE_DESCRIPTIONS } from "../contracts/agent-access";
import {
  type AgentClient,
  ClientResolutionError,
  isLocalRedirect,
  matchesRedirectUri,
  type MetadataFetch,
  redirectHost,
  resolveClient,
} from "./agent-clients";
import { createGrantWithCode, parseScopes } from "./agent-grants";
import { AGENT_LIMITS, admitAttempt, AttemptLimitError } from "./agent-limits";
import { resolveResource } from "./agent-resources";
import { CODE_CHALLENGE } from "./agent-tokens";
import { findRequestByBookingId } from "./booking-links";
import { type Database, database, type Queryable } from "./database";
import { readHostStanding } from "./host-eligibility";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal, listedOrigins, requestAppOrigin, unknownHost } from "./same-origin";
import { sourceHash } from "./signup-limits";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// The authorization endpoint and the consent decision (agent-access D7, D8,
// D12, D13, design 7 and 8).
//
// GET /connect/authorize validates a client's request in a fixed order. Until
// the redirect URI is known to belong to the client, a failure shows an error
// page and never redirects; after it, failures redirect to the client with the
// OAuth error, its state and our issuer. A valid request becomes a transaction
// bound to this browser by a random nonce in an HttpOnly cookie scoped to
// /connect, and the browser continues to the consent page /connect/consent.
//
// POST /connect/decision accepts Allow or Deny only from the application's own
// origin, from the browser holding the binding, for a live undecided
// transaction and, for the host resource, from the signed-in eligible host.
// Allow records the grant with the permissions the person left checked and a
// single-use code; either way the transaction is spent.

export const BINDING_COOKIE = "fmat_connect";
const BINDING_PATH = "/connect";
const BINDING_SECONDS = 24 * 60 * 60;

export type AgentAuthorizeDependencies = AppOrigins & {
  readonly db: Database;
  readonly auth: SupabaseAuthConfig;
  readonly tokenKey: () => TokenKey;
  readonly fetchMetadata?: MetadataFetch;
};

export function agentAuthorizeDependenciesFromEnvironment(): AgentAuthorizeDependencies {
  return { ...appOriginsFromEnvironment(), auth: supabaseAuthConfigFromEnvironment(), db: database(), tokenKey: tokenKeyFromEnvironment };
}

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex",
} as const;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

// A readable failure that never redirects to an unvalidated address.
export function errorPage(message: string, status = 400) {
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>This connection cannot continue</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">
<h1 style="font-size: 1.5rem">This connection cannot continue</h1>
<p>${escapeHtml(message)}</p>
<p>Nothing was connected. Start again from your agent, or continue at <a href="/">Find Me a Time</a>.</p>
</body></html>`;
  return new Response(body, { headers: PAGE_HEADERS, status });
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bindingCookie(value: string, origin: string) {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${BINDING_COOKIE}=${value}; Path=${BINDING_PATH}; Max-Age=${BINDING_SECONDS}; HttpOnly; SameSite=Lax${secure}`;
}

const NONCE = /^[A-Za-z0-9_-]{43}$/;

export function bindingNonce(request: Request) {
  const value = parseCookieHeader(request.headers.get("cookie") ?? "").find((cookie) => cookie.name === BINDING_COOKIE)?.value;
  return value && NONCE.test(value) ? value : null;
}

// The client's redirect URI with the response parameters added to its own query.
export function clientRedirect(redirectUri: string, params: Record<string, string | null | undefined>) {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(name, value);
  }
  return new Response(null, { headers: { "cache-control": "no-store", location: url.toString(), "referrer-policy": "no-referrer" }, status: 303 });
}

const PARAMETERS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "resource", "scope", "state"] as const;

// GET /connect/authorize
export function createAuthorizeHandler(load: () => AgentAuthorizeDependencies = agentAuthorizeDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();

    const params = new URL(request.url).searchParams;
    if (PARAMETERS.some((name) => params.getAll(name).length > 1)) return errorPage("The request repeats a parameter.");

    const clientId = params.get("client_id");
    const redirectUri = params.get("redirect_uri");
    if (!clientId || !redirectUri) return errorPage("The request does not name its client and redirect address.");

    let client: AgentClient;
    try {
      client = await resolveClient(deps, clientId, listedOrigins(deps));
    } catch (error) {
      if (error instanceof ClientResolutionError) return errorPage("The agent that sent you here is not registered with Find Me a Time.");
      throw error;
    }

    if (!matchesRedirectUri(client.redirectUris, redirectUri)) {
      return errorPage("The agent asked to return to an address it did not register.");
    }

    // From here on the redirect URI is the client's own: errors go back to it.
    const state = params.get("state");
    const fail = (error: string, description: string) =>
      clientRedirect(redirectUri, { error, error_description: description, iss: origin, state });

    if (state !== null && state.length > 1000) return fail("invalid_request", "The state is too long.");
    if (params.get("response_type") !== "code") return fail("unsupported_response_type", "Only the code response type is supported.");

    const challenge = params.get("code_challenge");
    if (params.get("code_challenge_method") !== "S256" || !challenge || !CODE_CHALLENGE.test(challenge)) {
      return fail("invalid_request", "An S256 code challenge is required.");
    }

    const resourceValue = params.get("resource");
    const resource = resourceValue ? await resolveResource(deps.db, origin, resourceValue) : null;
    if (!resource) return fail("invalid_target", "The resource is not a Find Me a Time MCP endpoint on this site.");

    const scopes = parseScopes(params.get("scope"), resource.role);
    if (!scopes) return fail("invalid_scope", `Request one or more of: ${roleScopes(resource.role).join(" ")}.`);

    const source = sourceHash(deps.tokenKey(), request);
    try {
      await admitAttempt(deps.db, "authorization", [{ bound: AGENT_LIMITS.authorizationPerSource, key: source }]);
    } catch (error) {
      if (error instanceof AttemptLimitError) return fail("temporarily_unavailable", "Too many connection attempts. Try again later.");
      throw error;
    }

    const nonce = bindingNonce(request) ?? randomBytes(32).toString("base64url");
    const [transaction] = await deps.db<{ id: string }[]>`
      insert into app.agent_authorization_transactions
        (client_id, redirect_uri, state, code_challenge, resource, role, target_host_account_id, target_handle,
         requested_scopes, binding_hash, source_hash)
      values (${client.id}, ${redirectUri}, ${state}, ${challenge}, ${resource.resource}, ${resource.role},
              ${resource.role === "requester" ? resource.hostAccountId : null},
              ${resource.role === "requester" ? resource.handle : null},
              ${scopes as string[]}, ${sha256(nonce)}, ${source})
      returning id
    `;

    return new Response(null, {
      headers: {
        "cache-control": "no-store",
        location: `${origin}/connect/consent?transaction=${transaction!.id}`,
        "referrer-policy": "no-referrer",
        "set-cookie": bindingCookie(nonce, origin),
      },
      status: 303,
    });
  };
}

// ---------------------------------------------------------------------------
// The consent page's view

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConsentView =
  | { readonly status: "unavailable" }
  | {
      readonly status: "open";
      readonly transactionId: string;
      readonly role: AgentRole;
      readonly clientName: string;
      readonly clientKind: AgentClient["kind"];
      readonly redirectHost: string;
      readonly localOnly: boolean;
      readonly scopes: readonly { readonly scope: AgentScope; readonly description: string }[];
      // The displayed host, for a requester resource.
      readonly host: { readonly handle: string; readonly displayName: string } | null;
      // For a host resource: whether a host is signed in, and eligible.
      readonly signedIn: "eligible" | "ineligible" | "signed_out" | null;
    };

type TransactionRow = {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  resource: string;
  role: AgentRole;
  target_host_account_id: string | null;
  target_handle: string | null;
  requested_scopes: AgentScope[];
  source_hash: string;
  binding_hash: string;
};

// A live, undecided transaction this browser opened, or null.
export async function liveTransaction(db: Queryable, id: string, nonce: string | null, lock = false) {
  if (!UUID.test(id) || !nonce) return null;
  const rows = lock
    ? await db<TransactionRow[]>`
        select id, client_id, redirect_uri, state, code_challenge, resource, role, target_host_account_id, target_handle,
               requested_scopes, source_hash, binding_hash
        from app.agent_authorization_transactions
        where id = ${id} and decided_at is null and expires_at > now()
        for update
      `
    : await db<TransactionRow[]>`
        select id, client_id, redirect_uri, state, code_challenge, resource, role, target_host_account_id, target_handle,
               requested_scopes, source_hash, binding_hash
        from app.agent_authorization_transactions
        where id = ${id} and decided_at is null and expires_at > now()
      `;
  const row = rows[0];
  return row && row.binding_hash === sha256(nonce) ? row : null;
}

// Whether a host transaction is live and undecided, for the sign-in return.
export async function isLiveHostTransaction(db: Database, id: string) {
  if (!UUID.test(id)) return false;
  const [row] = await db<{ id: string }[]>`
    select id from app.agent_authorization_transactions
    where id = ${id} and role = 'host' and decided_at is null and expires_at > now()
  `;
  return Boolean(row);
}

export async function readConsent(deps: AgentAuthorizeDependencies, request: Request, transactionId: string): Promise<ConsentView> {
  const transaction = await liveTransaction(deps.db, transactionId, bindingNonce(request));
  if (!transaction) return { status: "unavailable" };

  const [client] = await deps.db<{ client_name: string; kind: AgentClient["kind"]; redirect_uris: string[] }[]>`
    select client_name, kind, redirect_uris from app.agent_clients where id = ${transaction.client_id} and disabled_at is null
  `;
  if (!client) return { status: "unavailable" };

  let host: { handle: string; displayName: string } | null = null;
  let signedIn: "eligible" | "ineligible" | "signed_out" | null = null;

  if (transaction.role === "requester") {
    const origin = new URL(transaction.resource).origin;
    const resource = await resolveResource(deps.db, origin, transaction.resource);
    if (resource?.role !== "requester" || resource.hostAccountId !== transaction.target_host_account_id) return { status: "unavailable" };
    host = { displayName: resource.displayName, handle: resource.handle };
  } else {
    const userId = await verifiedUserId(request, deps.auth);
    const standing = userId ? await readHostStanding(deps.db, userId) : null;
    signedIn = !standing ? "signed_out" : standing.eligible ? "eligible" : "ineligible";
  }

  return {
    clientKind: client.kind,
    clientName: client.client_name,
    host,
    localOnly: client.redirect_uris.every(isLocalRedirect) || isLocalRedirect(transaction.redirect_uri),
    redirectHost: redirectHost(transaction.redirect_uri),
    role: transaction.role,
    scopes: transaction.requested_scopes.map((scope) => ({ description: SCOPE_DESCRIPTIONS[scope], scope })),
    signedIn,
    status: "open",
    transactionId: transaction.id,
  };
}

// ---------------------------------------------------------------------------
// The decision

const BOOKING_LINK = /(?:\/booking\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

// The booking identifier in a pasted booking link or a bare identifier.
export function bookingIdFromLink(value: string) {
  const trimmed = value.trim().split(/[?#]/)[0] ?? "";
  return trimmed.match(BOOKING_LINK)?.[1]?.toLowerCase() ?? null;
}

function backToConsent(origin: string, transactionId: string, problem: string) {
  return new Response(null, {
    headers: { "cache-control": "no-store", location: `${origin}/connect/consent?transaction=${transactionId}&problem=${problem}` },
    status: 303,
  });
}

// POST /connect/decision: a form with transaction, decision (allow or deny),
// one scope field per checked permission and, for requesters, choice (new or
// existing) and bookingLink.
export function createDecisionHandler(load: () => AgentAuthorizeDependencies = agentAuthorizeDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: false });
    if (refused) return refused;

    const origin = requestAppOrigin(request, deps)!;
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const text = type === "application/x-www-form-urlencoded" ? await request.text().catch(() => "") : "";
    const form = new URLSearchParams(text.length <= 8192 ? text : "");
    const transactionId = form.get("transaction") ?? "";
    const decision = form.get("decision");
    const nonce = bindingNonce(request);

    if (decision !== "allow" && decision !== "deny") return errorPage("Choose Allow or Deny.");

    // Host consent needs the signed-in eligible host, read before the transaction.
    const userId = await verifiedUserId(request, deps.auth);
    const standing = userId ? await readHostStanding(deps.db, userId) : null;

    const outcome = await deps.db.begin(async (tx) => {
      const transaction = await liveTransaction(tx, transactionId, nonce, true);
      if (!transaction) return { kind: "unavailable" as const };

      const decide = (value: "allowed" | "denied") =>
        tx`update app.agent_authorization_transactions set decided_at = now(), decision = ${value} where id = ${transaction.id}`;

      if (decision === "deny") {
        await decide("denied");
        return { kind: "redirect" as const, params: { error: "access_denied", error_description: "The person denied access." }, transaction };
      }

      let hostAccountId: string;
      let requestId: string | null = null;
      let bootstrap = false;

      if (transaction.role === "host") {
        if (!standing?.eligible || !standing.hostAccountId) return { kind: "sign_in" as const, transaction };
        hostAccountId = standing.hostAccountId;
      } else {
        hostAccountId = transaction.target_host_account_id!;
        const resource = await resolveResource(tx, origin, transaction.resource);
        if (resource?.role !== "requester" || resource.hostAccountId !== hostAccountId) {
          await decide("denied");
          return { kind: "redirect" as const, params: { error: "access_denied", error_description: "This host is not taking requests." }, transaction };
        }

        if (form.get("choice") === "existing") {
          const bookingId = bookingIdFromLink(form.get("bookingLink") ?? "");
          const link = bookingId ? await findRequestByBookingId(tx, bookingId) : null;
          const [owned] = link && !link.expired
            ? await tx<{ id: string }[]>`
                select id from app.requests
                where id = ${link.requestId} and host_account_id = ${hostAccountId} and state <> 'draft'
                  and closed_at is null and expires_at > now()
              `
            : [];
          if (!owned) return { kind: "problem" as const, problem: "link", transaction };
          requestId = owned.id;
        } else if (form.get("choice") === "new") {
          bootstrap = true;
        } else {
          return { kind: "problem" as const, problem: "choice", transaction };
        }
      }

      const chosen = form.getAll("scope");
      const scopes = transaction.requested_scopes.filter((scope) => chosen.includes(scope));
      if (scopes.length === 0 || chosen.some((scope) => !transaction.requested_scopes.includes(scope as AgentScope))) {
        return { kind: "problem" as const, problem: "scope", transaction };
      }

      const { code } = await createGrantWithCode(
        tx,
        {
          bootstrap,
          clientId: transaction.client_id,
          hostAccountId,
          requestId,
          resource: transaction.resource,
          role: transaction.role,
          scopes,
          sourceHash: transaction.source_hash,
        },
        { codeChallenge: transaction.code_challenge, redirectUri: transaction.redirect_uri },
      );
      await decide("allowed");
      return { kind: "redirect" as const, params: { code }, transaction };
    });

    if (outcome.kind === "unavailable") {
      return errorPage("This connection request expired, was already answered or was opened in another browser.");
    }
    if (outcome.kind === "sign_in") return backToConsent(origin, outcome.transaction.id, "sign_in");
    if (outcome.kind === "problem") return backToConsent(origin, outcome.transaction.id, outcome.problem);

    return clientRedirect(outcome.transaction.redirect_uri, { ...outcome.params, iss: origin, state: outcome.transaction.state });
  };
}
