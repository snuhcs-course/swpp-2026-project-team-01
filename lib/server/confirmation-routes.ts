import { z } from "zod";
import type { CommandErrorCategory } from "../contracts/command-errors";
import { findRequestByBookingId } from "./booking-links";
import { type Actor, runCommand } from "./commands";
import {
  type ConfirmationLimits,
  confirmContact,
  readConfirmationStatus,
  resendConfirmationCommand,
} from "./contact-confirmation";
import { database, type Database } from "./database";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Routes of the contact confirmation card under /api/requests/{bookingId}/
// confirmation. The booking identifier in the path is the requester's only
// credential: it is looked up by hash, and a malformed, unknown or expired one,
// or a closed request, gets the same generic unavailable answer. Every response
// carries the booking route's headers, so the identifier never leaves in a
// referrer, an index or a cache.

export const REQUESTER_HEADERS = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
} as const;

export function requesterJson(body: unknown, status = 200) {
  return Response.json(body, { headers: REQUESTER_HEADERS, status });
}

export function requestUnavailable() {
  return requesterJson({ code: "unavailable", error: "This booking link is not available." }, 404);
}

export type ConfirmationRouteDependencies = AppOrigins & {
  readonly db: Database;
  readonly tokenKey: () => TokenKey;
  readonly limits?: Partial<ConfirmationLimits>;
};

export function confirmationRouteDependenciesFromEnvironment(): ConfirmationRouteDependencies {
  return { ...appOriginsFromEnvironment(), db: database(), tokenKey: tokenKeyFromEnvironment };
}

type Context = { readonly params: Promise<{ readonly bookingId: string }> };

// The requester actor the booking identifier names, or null when the link is
// unknown, malformed, expired or its request closed.
export async function requesterActor(db: Database, bookingId: string): Promise<Actor | null> {
  const link = await findRequestByBookingId(db, bookingId);

  if (!link || link.expired) return null;

  const [request] = await db<{ open: boolean }[]>`
    select closed_at is null and expires_at > now() as open from app.requests where id = ${link.requestId}
  `;
  return request?.open ? { id: link.requestId, kind: "requester_request" } : null;
}

// GET: the card's queued, sent, rejected, uncertain and confirmed states, so a
// reload recovers the current status.
export function createConfirmationStatusHandler(
  load: () => ConfirmationRouteDependencies = confirmationRouteDependenciesFromEnvironment,
) {
  return async (_request: Request, context: Context) => {
    const deps = load();
    const actor = await requesterActor(deps.db, (await context.params).bookingId);

    if (!actor) return requestUnavailable();

    const status = await readConfirmationStatus(deps.db, actor.id, deps.limits);
    return status ? requesterJson(status) : requestUnavailable();
  };
}

export const COMMAND_STATUS: Readonly<Record<CommandErrorCategory, number>> = {
  forbidden: 404,
  booking_pending: 409,
  identity_required: 409,
  internal: 500,
  rate_limited: 429,
  request_closed: 409,
  invalid_input: 400,
  retry_conflict: 409,
  stale_revision: 409,
  unauthenticated: 404,
  unavailable_configuration: 503,
};

const resendBody = z.object({ retryKey: z.string().min(1).max(200) });

// POST: **Send the email again**, with the card's retry key.
export function createResendConfirmationHandler(
  load: () => ConfirmationRouteDependencies = confirmationRouteDependenciesFromEnvironment,
) {
  return async (request: Request, context: Context) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const actor = await requesterActor(deps.db, (await context.params).bookingId);

    if (!actor) return requestUnavailable();

    const body = resendBody.safeParse(await request.json().catch(() => null));

    if (!body.success) return requesterJson({ code: "invalid_request", error: "Send a retry key." }, 400);

    const outcome = await runCommand(
      { authenticate: async () => actor, db: deps.db },
      resendConfirmationCommand({ limits: deps.limits, origin: deps.appOrigin, tokenKey: deps.tokenKey() }),
      { input: {}, resourceId: actor.id, retryKey: body.data.retryKey },
    );

    if (!outcome.ok) {
      return outcome.error.category === "forbidden" || outcome.error.category === "unauthenticated"
        ? requestUnavailable()
        : requesterJson(outcome, COMMAND_STATUS[outcome.error.category]);
    }

    return requesterJson(outcome, outcome.result.status === "limited" ? 429 : 202);
  };
}

const confirmBody = z.object({ token: z.string().min(1).max(256) });

// POST /api/contact-confirmations: **Confirm this address** on the page the
// creation email's link opens. Opening the page confirms nothing; only this
// same-origin POST does, so a link scanner that fetches the URL cannot. The
// token is in the body, not another URL.
export function createConfirmContactHandler(
  load: () => Pick<ConfirmationRouteDependencies, "allowedOrigins" | "appOrigin" | "db"> = confirmationRouteDependenciesFromEnvironment,
) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const body = confirmBody.safeParse(await request.json().catch(() => null));
    const outcome = body.success ? await confirmContact(deps.db, body.data.token) : "unavailable";
    return requesterJson({ outcome }, outcome === "confirmed" ? 200 : 404);
  };
}
