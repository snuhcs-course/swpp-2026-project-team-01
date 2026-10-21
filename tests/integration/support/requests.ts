import { randomBytes, randomUUID } from "node:crypto";
import { hashBookingId, sealBookingLink } from "../../../lib/server/booking-links";
import type { Database } from "../../../lib/server/database";
import { type ClaimedJob, type JobHandler, type JobResult, processJob } from "../../../lib/server/jobs";
import { parseTokenKey } from "../../../lib/server/token-encryption";
import { newHostAccount } from "./ready-host";

// Open requests with a hashed and sealed booking link, written the way request
// creation leaves them, for suites that exercise contact email and resend
// without the intake flow. Every call makes its own host and request, so suites
// sharing the local stack never see each other's rows.

export const testTokenKey = parseTokenKey(randomBytes(32).toString("base64"));

export function uniqueEmail(prefix = "guest") {
  return `${prefix}-${randomUUID().slice(0, 12)}@example.test`;
}

export type TestRequest = {
  readonly bookingId: string;
  readonly contactEmail: string;
  readonly hostAccountId: string;
  readonly requestId: string;
};

export async function createTestRequest(
  db: Database,
  options: {
    readonly contactEmail?: string;
    readonly confirmed?: boolean;
    readonly language?: "en" | "ko";
    readonly hostAccountId?: string;
  } = {},
): Promise<TestRequest> {
  const hostAccountId = options.hostAccountId ?? (await newHostAccount(db));
  const contactEmail = options.contactEmail ?? uniqueEmail();
  const bookingId = randomUUID();
  const details = { language: options.language ?? "en", timezone: "Asia/Seoul", windows: [] };
  const [request] = await db<{ id: string }[]>`
    insert into app.requests (host_account_id, details, requester_name, contact_email, contact_confirmed_email, expires_at)
    values (${hostAccountId}, ${db.json(details)}, 'Grace Hopper', ${contactEmail},
            ${options.confirmed ? contactEmail : null}, now() + interval '7 days')
    returning id
  `;
  const sealed = sealBookingLink(testTokenKey, request!.id, bookingId);
  await db`
    insert into app.booking_links (request_id, link_hash, link_ciphertext, link_key_id)
    values (${request!.id}, ${hashBookingId(bookingId)}, ${sealed.ciphertext}, ${sealed.keyId})
  `;

  return { bookingId, contactEmail, hostAccountId, requestId: request!.id };
}

export async function closeTestRequest(db: Database, requestId: string) {
  await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${requestId}`;
}

// Leases one specific job, as a worker claim would, and runs it, so a suite never
// claims another suite's jobs of the same kind.
export async function runJob(db: Database, jobId: string, handler: JobHandler): Promise<JobResult | "not_due"> {
  const [row] = await db<{ attempts: number; fence: number; id: string; kind: string; max_attempts: number; payload: Record<string, unknown> }[]>`
    update app.jobs
    set state = 'running', attempts = attempts + 1, fence = fence + 1, lease_owner = 'test',
        lease_expires_at = now() + interval '2 minutes', updated_at = now()
    where id = ${jobId} and state = 'pending'
    returning id, kind, payload, attempts, max_attempts, fence
  `;

  if (!row) return "not_due";

  const job: ClaimedJob = {
    attempts: row.attempts,
    fence: row.fence,
    id: row.id,
    kind: row.kind,
    maxAttempts: row.max_attempts,
    payload: row.payload,
  };
  return processJob(db, job, handler);
}

export async function jobFor(db: Database, kind: string, dedupeKey: string) {
  const [row] = await db<{ id: string; state: string }[]>`
    select id, state from app.jobs where kind = ${kind} and dedupe_key = ${dedupeKey}
  `;
  return row ?? null;
}
