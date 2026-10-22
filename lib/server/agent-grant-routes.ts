import { z } from "zod";
import { listHostGrants, listRequestGrants, revokeGrantCommand } from "./agent-grants";
import { findRequestByBookingId } from "./booking-links";
import { json } from "./chat-routes";
import { runCommand } from "./commands";
import { REQUESTER_HEADERS, requestUnavailable } from "./confirmation-routes";
import { type Database, database } from "./database";
import { findHostAccountByAuthUser } from "./host-accounts";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";

// Connected agents (agent-access design 10):
//   GET  /api/agent-grants                           the signed-in host's grants
//   POST /api/agent-grants/revoke                    { grantId, retryKey }
//   GET  /api/requests/{bookingId}/agent-grants      the grants on one request
// A requester revokes through the requester commands route (agent.revoke_grant).
// A suspended host may still list and revoke, as the page list keeps narrowly
// authorized grant revocation available.

export type AgentGrantRouteDependencies = AppOrigins & {
  readonly auth: SupabaseAuthConfig;
  readonly db: Database;
};

export function agentGrantRouteDependenciesFromEnvironment(): AgentGrantRouteDependencies {
  return { ...appOriginsFromEnvironment(), auth: supabaseAuthConfigFromEnvironment(), db: database() };
}

async function hostAccountOf(deps: AgentGrantRouteDependencies, request: Request) {
  const userId = await verifiedUserId(request, deps.auth);
  return userId ? await findHostAccountByAuthUser(deps.db, userId) : null;
}

const unauthenticated = () => json({ code: "authentication_required", error: "Sign in to continue." }, 401);

export function createHostGrantListHandler(load: () => AgentGrantRouteDependencies = agentGrantRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const account = await hostAccountOf(deps, request);
    return account ? json({ grants: await listHostGrants(deps.db, account.id) }) : unauthenticated();
  };
}

const revokeBody = z.object({ grantId: z.uuid(), retryKey: z.string().min(1).max(200) });

export function createHostGrantRevokeHandler(load: () => AgentGrantRouteDependencies = agentGrantRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;

    const account = await hostAccountOf(deps, request);
    if (!account) return unauthenticated();

    const body = revokeBody.safeParse(await request.json().catch(() => null));
    if (!body.success) return json({ code: "invalid_request", error: "Name the connection to revoke." }, 400);

    const outcome = await runCommand(
      { authenticate: async () => ({ id: account.id, kind: "host_account" }), db: deps.db },
      revokeGrantCommand,
      { input: { grantId: body.data.grantId }, resourceId: account.id, retryKey: body.data.retryKey },
    );
    return outcome.ok
      ? json({ grants: await listHostGrants(deps.db, account.id) })
      : json({ error: outcome.error, grants: await listHostGrants(deps.db, account.id) }, outcome.error.category === "forbidden" ? 404 : 400);
  };
}

export function createRequestGrantListHandler(load: () => AgentGrantRouteDependencies = agentGrantRouteDependenciesFromEnvironment) {
  return async (_request: Request, context: { readonly params: Promise<{ readonly bookingId: string }> }) => {
    const deps = load();
    const link = await findRequestByBookingId(deps.db, (await context.params).bookingId);
    if (!link || link.expired) return requestUnavailable();
    return Response.json({ grants: await listRequestGrants(deps.db, link.requestId) }, { headers: REQUESTER_HEADERS });
  };
}
