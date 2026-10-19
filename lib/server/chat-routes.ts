import { z } from "zod";
import {
  acceptHostMessage,
  agentUrlFromEnvironment,
  ConversationInputError,
  type ConversationDependencies,
  eveRuntime,
} from "./conversations";
import { database } from "./database";
import { HostIneligibleError } from "./host-eligibility";
import { internalSigningKey } from "./internal-bearer";
import { createRequestAuthClient, type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment } from "./supabase-auth";

// Web routes for the /app conversation. Each authenticates the Supabase session
// itself and returns audience-safe JSON; nothing here trusts a client-supplied
// actor, session ID or generation.

export type ChatRouteDependencies = ConversationDependencies & { readonly auth: SupabaseAuthConfig };

export function chatDependenciesFromEnvironment(): ChatRouteDependencies {
  return {
    auth: supabaseAuthConfigFromEnvironment(),
    db: database(),
    runtime: eveRuntime(agentUrlFromEnvironment()),
    signingKey: internalSigningKey(),
  };
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { headers: { "cache-control": "private, no-store" }, status });
}

export async function authenticatedUserId(request: Request, auth: SupabaseAuthConfig) {
  const { client } = createRequestAuthClient(request, auth);
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user.id;
}

export function chatError(error: unknown) {
  if (error instanceof HostIneligibleError) {
    return json({ code: "host_ineligible", error: "Hosting is unavailable for this account.", nextAction: error.nextAction }, 403);
  }

  if (error instanceof ConversationInputError) {
    const status = { invalid_message: 400, retry_conflict: 409, runtime_unavailable: 503 }[error.code];
    return json({ code: error.code, error: error.message }, status);
  }

  throw error;
}

const messageBody = z.object({ clientInputId: z.uuid(), message: z.string() });

// POST /api/chat/messages
export function createMessageHandler(load: () => ChatRouteDependencies = chatDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const userId = await authenticatedUserId(request, deps.auth);

    if (!userId) {
      return json({ code: "authentication_required", error: "Sign in to continue." }, 401);
    }

    const body = messageBody.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return json({ code: "invalid_message", error: "Send a message with its client input ID." }, 400);
    }

    try {
      const outcome = await acceptHostMessage(deps, userId, body.data);
      return json(outcome, outcome.status === "sent" ? 202 : 409);
    } catch (error) {
      return chatError(error);
    }
  };
}
