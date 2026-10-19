import { createHmac } from "node:crypto";
import type { Transaction } from "./database";
import type { TokenKey } from "./token-encryption";

// Sign-up bounds (host-admission: sign-up and handle abuse limits). A sign-up is
// the creation of a host account for a Google identity that has none; at most
// SIGNUP_LIMIT_PER_SOURCE per source address and SIGNUP_LIMIT_SERVICE service-wide
// in any rolling 24 hours. Only a keyed hash of the address is stored.

export const SIGNUP_LIMIT_PER_SOURCE = 3;
export const SIGNUP_LIMIT_SERVICE = 100;

export type SignUpLimits = {
  readonly perSource: number;
  readonly service: number;
};

export const SIGNUP_LIMITS: SignUpLimits = { perSource: SIGNUP_LIMIT_PER_SOURCE, service: SIGNUP_LIMIT_SERVICE };

export class SignUpLimitError extends Error {
  readonly bound: "source" | "service";

  constructor(bound: "source" | "service") {
    super(`The ${bound} sign-up bound is reached.`);
    this.name = "SignUpLimitError";
    this.bound = bound;
  }
}

// The client address as the platform reports it: the first x-forwarded-for hop
// (set by Vercel), else x-real-ip. Requests with neither share one bucket.
function sourceAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

// HMAC-SHA-256 of the source address under a key derived from the token key, so
// the stored value cannot be reversed by enumerating addresses without that key.
export function sourceHash(key: TokenKey, request: Request) {
  const derived = createHmac("sha256", key.key).update("find-me-a-time/signup-source/v1").digest();
  return createHmac("sha256", derived).update(sourceAddress(request)).digest("hex");
}

// Admits one sign-up inside the account-creating transaction, or throws. The
// source lock and then the service lock serialize concurrent sign-ups, so the
// counts cannot be overrun by a race.
export async function admitSignUp(tx: Transaction, source: string, limits: SignUpLimits = SIGNUP_LIMITS) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`app.signup_source:${source}`}, 0))`;
  await tx`select pg_advisory_xact_lock(hashtextextended('app.signup_service', 0))`;

  const [counts] = await tx<{ service: number; source: number }[]>`
    select
      count(*) filter (where source_hash = ${source})::int as source,
      count(*)::int as service
    from app.signup_attempts
    where created_at > now() - interval '24 hours'
  `;

  if (counts!.source >= limits.perSource) throw new SignUpLimitError("source");
  if (counts!.service >= limits.service) throw new SignUpLimitError("service");

  await tx`insert into app.signup_attempts (source_hash) values (${source})`;
}
