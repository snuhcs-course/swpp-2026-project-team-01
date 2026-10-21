import { z } from "zod";
import { isUsableHandle, normalizeHandle } from "../contracts/handles";
import { REQUEST_LANGUAGES } from "../contracts/request";
import { bookingUrl } from "./booking-links";
import { ndjsonResponse } from "./chat-routes";
import { runCommand } from "./commands";
import { COMMAND_STATUS, requesterJson } from "./confirmation-routes";
import { agentUrlFromEnvironment, eveRuntime } from "./conversations";
import { database } from "./database";
import { acceptGuestMessage, guestConversationStatus } from "./guest-conversations";
import {
  createIntake,
  findIntake,
  type IntakeLimits,
  IntakeLimitError,
  type IntakeRow,
  IntakeUnavailableError,
  noteIntakeContext,
} from "./intakes";
import { internalSigningKey } from "./internal-bearer";
import { findReadyHostByHandle } from "./readiness";
import { type CreationLimits, createRequestCommand, openRequestBookingId } from "./request-creation";
import { guestError, guestEventsResponse, type RequesterRouteDependencies } from "./requester-routes";
import { appOriginsFromEnvironment, crossSiteRefusal, requestAppOrigin } from "./same-origin";
import { sourceHash } from "./signup-limits";
import { tokenKeyFromEnvironment } from "./token-encryption";

// The public intake's application routes under /api/intake/{handle}/ (design
// decision 2). The tab's intake token travels in the X-Intake-Token header,
// never in a URL, and is looked up by hash on the handle's host. An unknown,
// unready or suspended host gets the same neutral answer as the public page.
// The visitor's browser never calls /eve/v1: history and the live stream are
// read here with an internal bearer for the intake's own discussion.

export const INTAKE_TOKEN_HEADER = "x-intake-token";

export type IntakeRouteDependencies = RequesterRouteDependencies & {
  readonly intakeLimits?: Partial<IntakeLimits>;
  readonly creationLimits?: Partial<CreationLimits>;
};

export function intakeRouteDependenciesFromEnvironment(): IntakeRouteDependencies {
  return {
    ...appOriginsFromEnvironment(),
    db: database(),
    runtime: eveRuntime(agentUrlFromEnvironment()),
    signingKey: internalSigningKey(),
    tokenKey: tokenKeyFromEnvironment,
  };
}

type Context = { readonly params: Promise<{ readonly handle: string }> };

function unavailable() {
  return requesterJson({ code: "unavailable", error: "This page is not taking requests." }, 404);
}

async function readyHost(deps: IntakeRouteDependencies, context: Context) {
  const handle = normalizeHandle((await context.params).handle);
  return isUsableHandle(handle) ? findReadyHostByHandle(deps.db, handle) : null;
}

async function intakeOf(deps: IntakeRouteDependencies, hostAccountId: string, request: Request) {
  return findIntake(deps.db, hostAccountId, request.headers.get(INTAKE_TOKEN_HEADER) ?? "");
}

// A new intake for a visitor without a usable token, within the source bounds.
async function startIntake(deps: IntakeRouteDependencies, hostAccountId: string, request: Request) {
  const created = await createIntake(deps.db, {
    hostAccountId,
    limits: deps.intakeLimits,
    sourceHash: sourceHash(deps.tokenKey(), request),
  });
  return { intake: (await findIntake(deps.db, hostAccountId, created.token))!, token: created.token };
}

function limited() {
  return requesterJson(
    { code: "rate_limited", error: "Too many new conversations from your network right now. Try again later." },
    429,
  );
}

const messageBody = z.object({
  clientInputId: z.uuid(),
  message: z.string(),
  timezone: z.string().max(64).optional(),
  language: z.enum(REQUEST_LANGUAGES).optional(),
});

// POST /api/intake/{handle}/messages. Without a usable token, the first message
// starts an intake and the answer carries its token once (also on a failure
// after the intake exists, so the tab keeps it).
export function createIntakeMessageHandler(load: () => IntakeRouteDependencies = intakeRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const host = await readyHost(deps, context);

    if (!host) return unavailable();

    const body = messageBody.safeParse(await request.json().catch(() => null));

    if (!body.success) return requesterJson({ code: "invalid_message", error: "Send a message with its client input ID." }, 400);

    let intake: IntakeRow | null = await intakeOf(deps, host.hostAccountId, request);
    let token: string | undefined;

    if (intake && !intake.open) {
      return requesterJson({ code: "closed", continued: intake.request_id !== null, error: "This conversation has ended." }, 409);
    }

    if (!intake) {
      try {
        ({ intake, token } = await startIntake(deps, host.hostAccountId, request));
      } catch (error) {
        if (error instanceof IntakeLimitError) return limited();
        if (error instanceof IntakeUnavailableError) return unavailable();
        throw error;
      }
    }

    const withToken = async (response: Response) => {
      if (!token) return response;
      const payload = (await response.json()) as Record<string, unknown>;
      return requesterJson({ ...payload, intakeToken: token }, response.status);
    };

    try {
      await deps.db.begin((tx) =>
        noteIntakeContext(tx, intake!.id, { language: body.data.language, timezone: body.data.timezone }),
      );
      const outcome = await acceptGuestMessage(deps, { id: intake.id, type: "public_intake" }, body.data);
      return withToken(requesterJson(outcome, outcome.status === "recovery_required" ? 409 : 202));
    } catch (error) {
      return withToken(guestError(error));
    }
  };
}

// GET /api/intake/{handle}/events?cursor=N[&follow=1]: nothing before the tab
// has an intake.
export function createIntakeEventsHandler(load: () => IntakeRouteDependencies = intakeRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const host = await readyHost(deps, context);

    if (!host) return unavailable();

    const intake = await intakeOf(deps, host.hostAccountId, request);

    if (!intake) return ndjsonResponse({ done: true, value: undefined }, (async function* () {})());
    return guestEventsResponse(deps, { id: intake.id, type: "public_intake" }, request);
  };
}

// GET /api/intake/{handle}/state: whether the tab's intake is open, and its
// conversation's generation and pending inputs.
export function createIntakeStateHandler(load: () => IntakeRouteDependencies = intakeRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const host = await readyHost(deps, context);

    if (!host) return unavailable();

    const intake = await intakeOf(deps, host.hostAccountId, request);

    if (!intake) {
      return requesterJson({ conversation: { generation: null, pendingInputs: 0, state: "none" }, intake: null });
    }

    return requesterJson({
      conversation: await guestConversationStatus(deps.db, { id: intake.id, type: "public_intake" }),
      intake: { continued: intake.request_id !== null, open: intake.open },
    });
  };
}

const continueBody = z.object({
  name: z.string(),
  email: z.string(),
  timezone: z.string(),
  language: z.enum(REQUEST_LANGUAGES),
});

// POST /api/intake/{handle}/continue: **Continue without Google**. It runs
// request.create as the intake, with the intake token's hash as the retry key,
// and answers the booking link once; an exact retry answers the same link.
export function createIntakeContinueHandler(load: () => IntakeRouteDependencies = intakeRouteDependenciesFromEnvironment) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const host = await readyHost(deps, context);

    if (!host) return unavailable();

    const body = continueBody.safeParse(await request.json().catch(() => null));

    if (!body.success) return requesterJson({ code: "invalid_input", error: "Enter your name and email." }, 400);

    let intake = await intakeOf(deps, host.hostAccountId, request);

    // Continue without Google before any message starts the tab's intake here.
    if (!intake) {
      try {
        intake = (await startIntake(deps, host.hostAccountId, request)).intake;
      } catch (error) {
        if (error instanceof IntakeLimitError) return limited();
        if (error instanceof IntakeUnavailableError) return unavailable();
        throw error;
      }
    }

    const tokenKey = deps.tokenKey();
    const origin = requestAppOrigin(request, deps) ?? deps.appOrigin;
    const outcome = await runCommand(
      { authenticate: async () => ({ id: intake.id, kind: "public_intake" }), db: deps.db },
      createRequestCommand({
        limits: deps.creationLimits,
        origin,
        signingKey: deps.signingKey,
        sourceHash: sourceHash(tokenKey, request),
        tokenKey,
      }),
      { input: body.data, resourceId: intake.id, retryKey: intake.token_hash },
    );

    if (!outcome.ok) {
      if (outcome.error.category === "forbidden" || outcome.error.category === "unauthenticated") return unavailable();
      if (outcome.error.category === "rate_limited") {
        return requesterJson({ code: "rate_limited", error: "Too many requests from your network right now. Try again later." }, 429);
      }
      if (outcome.error.category === "retry_conflict") {
        return requesterJson({ code: "already_continued", error: "This conversation already continued." }, 409);
      }
      return requesterJson(outcome, COMMAND_STATUS[outcome.error.category]);
    }

    const bookingId = await openRequestBookingId(deps.db, [tokenKey], outcome.result.requestId);

    if (!bookingId) return unavailable();

    return requesterJson({ bookingId, bookingUrl: bookingUrl(origin, bookingId), replayed: outcome.replayed }, 201);
  };
}
