import { z } from "zod";
import { COMMAND_ERROR_MESSAGES, type CommandErrorCategory } from "../contracts/command-errors";
import { IMESSAGE_OPERATIONS } from "../contracts/imessage";
import { json } from "./chat-routes";
import { runCommand } from "./commands";
import { database, type Database } from "./database";
import { readHostStanding } from "./host-eligibility";
import { fallbackDailyLimit, imessageCommands, readImessageStatus } from "./imessage-links";
import { photonConfig } from "./photon";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Web routes for the Connect iMessage card (host-imessage-channel design 4 to 6
// and 11):
//   GET  /api/host/imessage            the card's status
//   POST /api/host/imessage/commands   a card's command
// Each authenticates the Supabase session and the host's eligibility itself,
// answers private, uncached JSON, and never returns a code the service sent.

export type ImessageRouteDependencies = AppOrigins & {
  readonly auth: SupabaseAuthConfig;
  readonly db: Database;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly lineNumber: string;
  readonly lineDayLimit: number;
};

export function imessageRouteDependenciesFromEnvironment(): ImessageRouteDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return {
    ...appOriginsFromEnvironment(),
    auth: supabaseAuthConfigFromEnvironment(),
    db: database(),
    lineDayLimit: fallbackDailyLimit(),
    lineNumber: photonConfig().lineNumber,
    tokenKey,
    tokenKeys: [tokenKey],
  };
}

const COMMAND_STATUS: Readonly<Record<CommandErrorCategory, number>> = {
  booking_pending: 409,
  forbidden: 403,
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

async function hostOf(deps: ImessageRouteDependencies, request: Request) {
  const userId = await verifiedUserId(request, deps.auth);
  if (!userId) return { refusal: json({ code: "authentication_required", error: "Sign in to continue." }, 401) };

  const standing = await readHostStanding(deps.db, userId);
  if (!standing.eligible || !standing.hostAccountId) {
    return { refusal: json({ code: "host_ineligible", error: "Hosting is unavailable for this account.", nextAction: standing.nextAction }, 403) };
  }

  return { hostAccountId: standing.hostAccountId };
}

export function createImessageStatusHandler(load: () => ImessageRouteDependencies = imessageRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const host = await hostOf(deps, request);
    if (!host.hostAccountId) return host.refusal!;

    return json(await readImessageStatus(deps.db, deps.tokenKeys, host.hostAccountId, deps.lineNumber));
  };
}

const commandBody = z.object({
  operation: z.enum(IMESSAGE_OPERATIONS),
  retryKey: z.string().min(1).max(200),
  input: z.unknown(),
});

export function createImessageCommandHandler(load: () => ImessageRouteDependencies = imessageRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;

    const host = await hostOf(deps, request);
    if (!host.hostAccountId) return host.refusal!;

    const body = commandBody.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return json({ error: { category: "invalid_input", message: COMMAND_ERROR_MESSAGES.invalid_input } }, 400);
    }

    const hostAccountId = host.hostAccountId;
    const commands = imessageCommands({
      lineDayLimit: deps.lineDayLimit,
      lineNumber: deps.lineNumber,
      tokenKey: deps.tokenKey,
      tokenKeys: deps.tokenKeys,
    });
    const outcome = await runCommand(
      { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db: deps.db },
      commands[body.data.operation]!,
      { input: body.data.input ?? {}, resourceId: hostAccountId, retryKey: body.data.retryKey },
    );
    const status = await readImessageStatus(deps.db, deps.tokenKeys, hostAccountId, deps.lineNumber);

    return outcome.ok
      ? json({ result: outcome.result, status }, outcome.replayed ? 200 : 201)
      : json({ error: outcome.error, status }, COMMAND_STATUS[outcome.error.category]);
  };
}
