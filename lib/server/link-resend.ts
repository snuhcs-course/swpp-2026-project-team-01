import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { bookingUrl, openBookingLink } from "./booking-links";
import { database, type Database, type Transaction } from "./database";
import { enqueueEmail } from "./email-delivery";
import { type ClaimedJob, type JobHandler, publishJob } from "./jobs";
import { type AppOrigins, appOriginsFromEnvironment, crossSiteRefusal } from "./same-origin";
import { openToken, sealToken, type TokenKey, tokenKeyFromEnvironment } from "./token-encryption";

// Link resend (design decision 7). POST /api/booking-links/resend takes an email
// address and a retry key and always gives the same generic acceptance after the
// same work for every address: it charges the fixed-size attempt budget and, when
// the budget allows, records a link_resend_attempts row (the keyed address hash
// and the sealed address) and publishes a link_resend job. Nothing in the answer
// or its timing depends on whether the address matches a request. The job then
// matches open requests whose confirmed contact is the address and whose links
// are unexpired, applies the per-request, per-recipient and service limits, and
// inserts one frozen delivery per request keyed by the request and the retry key.

export const LINK_RESEND_JOB = "link_resend";

export const LINK_RESEND_LIMITS = {
  // Accepted attempts per minute, service-wide, before any matching.
  attemptsPerMinute: 600,
  perRequestMinute: 1,
  perRequestHour: 5,
  perRecipientHour: 5,
  serviceMinute: 120,
} as const;

export type LinkResendLimits = { readonly [Key in keyof typeof LINK_RESEND_LIMITS]: number };

export const GENERIC_RESEND_ANSWER = {
  message: "If that address is confirmed for an open request, we will email its booking link shortly.",
  status: "accepted",
} as const;

export function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

// HMAC-SHA-256 of the normalized address under a key derived from the token key,
// so a stored hash cannot be reversed by enumerating addresses without the key.
export function addressHash(key: TokenKey, address: string) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/link-resend-address/v1").digest();
  return createHmac("sha256", derived).update(normalizeAddress(address)).digest("hex");
}

function attemptContext(attemptId: string) {
  return `link_resend_attempt:${attemptId}`;
}

// Charges one attempt against the two-slot ring and says whether it fit. A slot
// belonging to an earlier minute starts over at this attempt. `at` replaces the
// database clock for tests.
export async function chargeAttemptBudget(tx: Transaction, limit: number, at?: Date) {
  const rows = await tx<{ count: number }[]>`
    with minute as (
      select date_trunc('minute', coalesce(${at ?? null}::timestamptz, clock_timestamp())) as start
    )
    insert into app.resend_budget (slot, minute_start, count)
    select (floor(extract(epoch from start) / 60)::bigint % 2)::smallint, start, 1 from minute
    on conflict (slot) do update set
      minute_start = excluded.minute_start,
      count = case when app.resend_budget.minute_start = excluded.minute_start then app.resend_budget.count + 1 else 1 end
    where app.resend_budget.minute_start <> excluded.minute_start or app.resend_budget.count < ${limit}
    returning count
  `;
  return rows.length > 0;
}

export type LinkResendRequest = {
  readonly email: string;
  readonly retryKey: string;
};

export type LinkResendDependencies = {
  readonly db: Database;
  readonly tokenKey: TokenKey;
  readonly limits?: Partial<LinkResendLimits>;
  // Replaces the database clock for the attempt budget, for tests.
  readonly now?: Date;
};

// Records one resend attempt, or nothing when the budget is spent. Always
// resolves the same way for every address.
export async function requestLinkResend(deps: LinkResendDependencies, request: LinkResendRequest) {
  const limits = { ...LINK_RESEND_LIMITS, ...deps.limits };
  const hash = addressHash(deps.tokenKey, request.email);
  const attemptId = randomUUID();
  const sealed = sealToken(deps.tokenKey, normalizeAddress(request.email), attemptContext(attemptId));

  await deps.db.begin(async (tx) => {
    if (!(await chargeAttemptBudget(tx, limits.attemptsPerMinute, deps.now))) return;

    const [attempt] = await tx<{ id: string }[]>`
      insert into app.link_resend_attempts (id, address_hash, address_ciphertext, address_key_id, retry_key)
      values (${attemptId}, ${hash}, ${sealed.ciphertext}, ${sealed.keyId}, ${request.retryKey})
      on conflict (address_hash, retry_key) do nothing
      returning id
    `;

    if (attempt) {
      await publishJob(tx, { dedupeKey: `attempt:${attempt.id}`, kind: LINK_RESEND_JOB, payload: { attemptId: attempt.id } });
    }
  });

  return GENERIC_RESEND_ANSWER;
}

type Match = {
  readonly id: string;
  readonly host_name: string | null;
  readonly language: string | null;
  readonly link_ciphertext: string;
  readonly link_key_id: string;
};

// Whether one more issuance fits every limit, read under the request's row lock
// and the recipient and service locks.
async function issuanceAllowed(tx: Transaction, requestId: string, recipientHash: string, limits: LinkResendLimits) {
  const [row] = await tx<{ allowed: boolean }[]>`
    select
      count(*) filter (where request_id = ${requestId} and created_at > now() - interval '1 minute') < ${limits.perRequestMinute}
      and count(*) filter (where request_id = ${requestId}) < ${limits.perRequestHour}
      and count(*) filter (where recipient_hash = ${recipientHash}) < ${limits.perRecipientHour}
      and (
        select count(*) from app.link_resend_issuances where created_at > now() - interval '1 minute'
      ) < ${limits.serviceMinute}
      as allowed
    from app.link_resend_issuances
    where created_at > now() - interval '1 hour' and (request_id = ${requestId} or recipient_hash = ${recipientHash})
  `;
  return row?.allowed ?? false;
}

export type LinkResendJobDependencies = {
  readonly tokenKeys: readonly TokenKey[];
  // The key new deliveries seal the booking link with.
  readonly tokenKey: TokenKey;
  readonly origin: string;
  readonly limits?: Partial<LinkResendLimits>;
};

function jobDependenciesFromEnvironment(): LinkResendJobDependencies {
  const tokenKey = tokenKeyFromEnvironment();
  return { origin: appOriginsFromEnvironment().appOrigin, tokenKey, tokenKeys: [tokenKey] };
}

export type LinkResendJobOutcome = { readonly matched: number; readonly issued: number };

export function createLinkResendHandler(
  load: () => LinkResendJobDependencies = jobDependenciesFromEnvironment,
): JobHandler {
  return async (tx: Transaction, job: ClaimedJob): Promise<LinkResendJobOutcome> => {
    const attemptId = typeof job.payload.attemptId === "string" ? job.payload.attemptId : null;
    const [attempt] = attemptId
      ? await tx<{ address_ciphertext: string; address_hash: string; address_key_id: string; id: string; retry_key: string }[]>`
          select id, address_hash, address_ciphertext, address_key_id, retry_key
          from app.link_resend_attempts where id = ${attemptId}
          for update
        `
      : [];

    if (!attempt) return { issued: 0, matched: 0 };

    const deps = load();
    const limits = { ...LINK_RESEND_LIMITS, ...deps.limits };
    const address = openToken(
      deps.tokenKeys,
      { ciphertext: attempt.address_ciphertext, keyId: attempt.address_key_id },
      attemptContext(attempt.id),
    );
    // Locks in a fixed order: the matched requests by ID, then the recipient,
    // then the service.
    const matches = await tx<Match[]>`
      select r.id, r.details ->> 'language' as language, s.settings ->> 'displayName' as host_name,
             l.link_ciphertext, l.link_key_id
      from app.requests r
      join app.booking_links l on l.request_id = r.id
      left join app.host_settings s on s.host_account_id = r.host_account_id
      where r.closed_at is null and r.expires_at > now() and l.expires_at > now()
        and lower(r.contact_confirmed_email) = ${address}
      order by r.id
      for update of r
    `;
    let issued = 0;

    if (matches.length > 0) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`app.link_resend_recipient:${attempt.address_hash}`}, 0))`;
      await tx`select pg_advisory_xact_lock(hashtextextended('app.link_resend_service', 0))`;
    }

    for (const match of matches) {
      if (!(await issuanceAllowed(tx, match.id, attempt.address_hash, limits))) continue;

      const bookingId = openBookingLink(deps.tokenKeys, { ...match, request_id: match.id });
      const delivery = await enqueueEmail(tx, {
        dedupeKey: `${match.id}:${attempt.retry_key}`,
        kind: "link_resend",
        language: match.language === "ko" ? "ko" : "en",
        parameters: { hostName: match.host_name ?? undefined },
        recipient: address,
        requestId: match.id,
        secrets: { bookingUrl: bookingUrl(deps.origin, bookingId) },
        tokenKey: deps.tokenKey,
      });

      if (delivery.created) {
        await tx`
          insert into app.link_resend_issuances (request_id, recipient_hash, retry_key)
          values (${match.id}, ${attempt.address_hash}, ${attempt.retry_key})
        `;
        issued += 1;
      }
    }

    await tx`delete from app.link_resend_attempts where id = ${attempt.id}`;
    return { issued, matched: matches.length };
  };
}

const resendBody = z.object({ email: z.email().max(320), retryKey: z.string().min(1).max(200) });

export type LinkResendRouteDependencies = AppOrigins & {
  readonly db: Database;
  readonly tokenKey: () => TokenKey;
  readonly limits?: Partial<LinkResendLimits>;
  readonly now?: Date;
};

function routeDependenciesFromEnvironment(): LinkResendRouteDependencies {
  return { ...appOriginsFromEnvironment(), db: database(), tokenKey: tokenKeyFromEnvironment };
}

const HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" };

// POST /api/booking-links/resend
export function createLinkResendRouteHandler(load: () => LinkResendRouteDependencies = routeDependenciesFromEnvironment) {
  return async (request: Request) => {
    const deps = load();
    const refused = crossSiteRefusal(request, deps, { json: true });

    if (refused) return refused;

    const body = resendBody.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return Response.json({ code: "invalid_request", error: "Enter an email address." }, { headers: HEADERS, status: 400 });
    }

    const answer = await requestLinkResend(
      { db: deps.db, limits: deps.limits, now: deps.now, tokenKey: deps.tokenKey() },
      body.data,
    );
    return Response.json(answer, { headers: HEADERS, status: 202 });
  };
}
