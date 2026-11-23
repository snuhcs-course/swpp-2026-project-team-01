import { createHash } from "node:crypto";
import type { Database } from "./database";

// The agent protocol's bounds (agent-access design 12). Each attempt is counted
// by kind and a hash of its key (a source hash, a client ID or a grant ID) in a
// sliding window; a refused attempt is not counted. The count and the insert run
// under an advisory lock per kind and key, so concurrent attempts cannot overrun
// a bound.

export type AttemptKind = "registration" | "authorization" | "token" | "metadata_fetch" | "tool_call";

export type Bound = { readonly limit: number; readonly windowSeconds: number };

// Hosted agents such as claude.ai register and redeem from a few shared egress
// addresses, and every person using a client ID metadata document presents the
// same client ID, so neither a source nor a client ID stands for one person.
// Token requests are therefore counted per presented credential (the code or
// refresh token, one live per grant) and per source with room for a shared
// egress; registration per source has room for a hosted agent's fallback to
// dynamic registration, under the service-wide bound.
//
// Hotfix 2026-11-23: no bound counts a network (source) address any more. People on one
// shared network (a campus, an office or a carrier NAT) present one address, so a
// per-address bound blocked them all at once.
// Registration keeps its service-wide bound and tokens their per-credential bound.
export const AGENT_LIMITS = {
  registrationService: { limit: 500, windowSeconds: 86_400 },
  tokenPerCredential: { limit: 10, windowSeconds: 60 },
  metadataFetchPerClient: { limit: 30, windowSeconds: 3600 },
  toolCallPerGrant: { limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, Bound>;

export type AgentLimits = { readonly [Key in keyof typeof AGENT_LIMITS]: Bound };

export class AttemptLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many attempts.");
    this.name = "AttemptLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type AttemptBound = { readonly key: string; readonly bound: Bound };

// The bounds of one dynamic registration: service-wide only.
export function registrationBounds(): AttemptBound[] {
  return [{ bound: AGENT_LIMITS.registrationService, key: "service" }];
}

// The bounds of one token request: per the code or refresh token it presents
// under its client.
export function tokenBounds(request: { readonly clientId: string; readonly credential: string }): AttemptBound[] {
  return [{ bound: AGENT_LIMITS.tokenPerCredential, key: `credential:${request.clientId}:${request.credential}` }];
}

function keyHash(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

// Records one attempt against every bound given, or throws AttemptLimitError
// with the seconds until the earliest counted attempt leaves its window.
export async function admitAttempt(
  db: Database,
  kind: AttemptKind,
  bounds: readonly AttemptBound[],
) {
  await db.begin(async (tx) => {
    for (const { key, bound } of bounds) {
      const hashed = keyHash(key);
      await tx`select pg_advisory_xact_lock(hashtextextended(${`app.agent_attempt:${kind}:${hashed}`}, 0))`;
      await tx`
        delete from app.agent_protocol_attempts
        where kind = ${kind} and key_hash = ${hashed} and created_at < now() - interval '1 day'
      `;
      const [row] = await tx<{ count: number; oldest: Date | null }[]>`
        select count(*)::int as count, min(created_at) as oldest
        from app.agent_protocol_attempts
        where kind = ${kind} and key_hash = ${hashed}
          and created_at > now() - make_interval(secs => ${bound.windowSeconds})
      `;

      if (row!.count >= bound.limit) {
        const elapsed = row!.oldest ? (Date.now() - row!.oldest.getTime()) / 1000 : 0;
        throw new AttemptLimitError(Math.max(1, Math.ceil(bound.windowSeconds - elapsed)));
      }
    }

    for (const { key } of bounds) {
      await tx`insert into app.agent_protocol_attempts (kind, key_hash) values (${kind}, ${keyHash(key)})`;
    }
  });
}
