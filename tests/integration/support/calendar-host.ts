import { randomUUID } from "node:crypto";
import { GOOGLE_CALENDAR_SCOPES } from "../../../lib/contracts/google-scopes";
import { CALENDAR_ANALYSIS_JOB } from "../../../lib/server/analysis";
import type { CommandDependencies } from "../../../lib/server/commands";
import type { Database } from "../../../lib/server/database";
import type { GoogleCalendarConfig } from "../../../lib/server/google-calendar";
import { type ClaimedJob, type JobHandler, processJob } from "../../../lib/server/jobs";
import { recordGoogleGrant } from "../../../lib/server/provider-grants";
import type { TokenKey } from "../../../lib/server/token-encryption";
import type { FakeGoogle } from "./fake-google";

// Helpers for the Calendar and analysis suites: a host seeded directly in SQL with
// a Google identity and a sealed grant, and a way to run one specific analysis job
// without claiming jobs another suite published.

export async function createCalendarHost(
  db: Database,
  key: TokenKey,
  options: { readonly scopes?: readonly string[]; readonly refreshToken?: string | null; readonly domain?: string } = {},
) {
  const email = `host-${randomUUID()}@${options.domain ?? "example.test"}`;
  const userId = randomUUID();
  const refreshToken = options.refreshToken === undefined ? `1//refresh-${randomUUID()}` : options.refreshToken;

  await db`insert into auth.users (id, email) values (${userId}, ${email})`;
  const [account] = await db<{ id: string }[]>`insert into app.host_accounts default values returning id`;
  const hostAccountId = account!.id;
  await db`
    insert into app.google_identities (google_subject, host_account_id, auth_user_id, email)
    values (${`sub-${randomUUID()}`}, ${hostAccountId}, ${userId}, ${email})
  `;
  await recordGoogleGrant(db, key, {
    grantedScopes: options.scopes ?? [...GOOGLE_CALENDAR_SCOPES],
    hostAccountId,
    refreshToken,
  });

  return { email, hostAccountId, refreshToken, userId };
}

export function hostCommandDeps(db: Database, hostAccountId: string): CommandDependencies {
  return { authenticate: async () => ({ id: hostAccountId, kind: "host_account" }), db };
}

export function fakeGoogleConfig(fake: FakeGoogle, overrides: Partial<GoogleCalendarConfig> = {}): GoogleCalendarConfig {
  return {
    apiBaseUrl: fake.apiBaseUrl,
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    timeoutMs: 5_000,
    tokenUrl: fake.tokenUrl,
    ...overrides,
  };
}

export async function suspend(db: Database, hostAccountId: string) {
  await db`update app.host_accounts set status = 'suspended' where id = ${hostAccountId}`;
}

export async function analysisJobs(db: Database, hostAccountId: string) {
  return db<{ id: string; payload: { analysisId: string }; state: string }[]>`
    select id, payload, state from app.jobs
    where kind = ${CALENDAR_ANALYSIS_JOB} and dedupe_key like ${`${CALENDAR_ANALYSIS_JOB}:${hostAccountId}:%`}
    order by created_at
  `;
}

// Leases one job as app.claim_jobs would and runs it through processJob, so the
// handler's writes and the completion commit together exactly as in the worker.
export async function runJob(db: Database, jobId: string, handler: JobHandler) {
  const [row] = await db<{ attempts: number; fence: number; id: string; kind: string; max_attempts: number; payload: Record<string, unknown> }[]>`
    update app.jobs
    set state = 'running', attempts = attempts + 1, fence = fence + 1, lease_owner = 'calendar-test',
        lease_expires_at = now() + interval '120 seconds', updated_at = now()
    where id = ${jobId} and state = 'pending'
    returning id, kind, payload, attempts, max_attempts, fence
  `;

  if (!row) throw new Error(`Job ${jobId} is not pending.`);

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
