import { z } from "zod";
import { COMMAND_ERROR_MESSAGES, type CommandErrorCategory } from "../contracts/command-errors";
import { IMESSAGE_OPERATIONS } from "../contracts/imessage";
import { json } from "./chat-routes";
import { CommandError, runCommand } from "./commands";
import { database, type Database } from "./database";
import { readHostStanding } from "./host-eligibility";
import { fallbackDailyLimit, imessageCommands, readImessageStatus } from "./imessage-links";
import { readStartStatus, startCookieFor, startImessageLink, startSecretOf } from "./imessage-start";
import { CONTINUATION_SECONDS, continuationCookie, readReceivedContinuation } from "./imessage-continuation";
import { photonConfig } from "./photon";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal, requestAppOrigin, unknownHost } from "./same-origin";
import { sourceHash } from "./signup-limits";
import { type SupabaseAuthConfig, supabaseAuthConfigFromEnvironment, verifiedUserId } from "./supabase-auth";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Web routes for the Connect iMessage card (host-imessage-channel design 4 to 6
// and 11):
//   GET  /api/host/imessage            the card's status
//   POST /api/host/imessage/commands   a card's command
// Each authenticates the Supabase session and the host's eligibility itself,
// answers private, uncached JSON, and never returns a code the service sent.
// The iMessage start on the public page (D15) needs no session:
//   GET  /api/imessage/start           this browser's attempt, by its cookie
//   POST /api/imessage/start           a new attempt for this browser
//   GET  /imessage/continue            the sign-in link in Thyme's reply (D19)

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

// The signed-in host. Unlinking stays available to a suspended host, who keeps
// the right to end a binding, as with revoking agent connections.
async function hostOf(deps: ImessageRouteDependencies, request: Request, options: { readonly allowSuspended?: boolean } = {}) {
  const userId = await verifiedUserId(request, deps.auth);
  if (!userId) return { refusal: json({ code: "authentication_required", error: "Sign in to continue." }, 401) };

  const standing = await readHostStanding(deps.db, userId);
  if (options.allowSuspended && standing.hostAccountId && standing.nextAction === "account_suspended") {
    return { hostAccountId: standing.hostAccountId };
  }
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

    const body = commandBody.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return json({ error: { category: "invalid_input", message: COMMAND_ERROR_MESSAGES.invalid_input } }, 400);
    }

    const host = await hostOf(deps, request, { allowSuspended: body.data.operation === "imessage.unlink" });
    if (!host.hostAccountId) return host.refusal!;

    const hostAccountId = host.hostAccountId;
    const commands = imessageCommands({
      lineDayLimit: deps.lineDayLimit,
      lineNumber: deps.lineNumber,
      origin: deps.appOrigin,
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

// GET /api/imessage/start: this browser's attempt from the iMessage start.
export function createImessageStartStatusHandler(load: () => ImessageRouteDependencies = imessageRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    return json(await readStartStatus(deps.db, deps, startSecretOf(request)));
  };
}

// POST /api/imessage/start: a new link code for this browser, which keeps the
// cookie it already has or gets one. Bounded per source address and service-wide.
export function createImessageStartHandler(load: () => ImessageRouteDependencies = imessageRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });
    if (refused) return refused;
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();

    const cookie = startCookieFor(origin, startSecretOf(request));
    try {
      await startImessageLink(deps.db, deps, cookie.secret, sourceHash(deps.tokenKey, request));
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
      return json({ error: { category: error.category, message: COMMAND_ERROR_MESSAGES[error.category] } }, COMMAND_STATUS[error.category]);
    }

    const response = json(await readStartStatus(deps.db, deps, cookie.secret), 201);
    response.headers.append("set-cookie", cookie.header);
    return response;
  };
}

// GET /imessage/continue?token=…, the link in Thyme's reply to a code from the
// iMessage start (D19). A live one is kept in an HttpOnly cookie for the
// callback, then Google sign-in asks for Calendar; one that ran out, was used or
// was tampered with goes back to the iMessage start to begin again.
export function createImessageContinueHandler(load: () => ImessageRouteDependencies = imessageRouteDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const origin = requestAppOrigin(request, deps);
    if (!origin) return unknownHost();
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const live = await readReceivedContinuation(deps.db, deps.tokenKey, token);
    const headers = new Headers({ "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" });
    if (live) headers.set("set-cookie", continuationCookie(token, origin, CONTINUATION_SECONDS));
    headers.set("location", live ? `${origin}/auth/sign-in?return=imessage` : `${origin}/?flow=imessage`);
    return new Response(null, { status: 303, headers });
  };
}
