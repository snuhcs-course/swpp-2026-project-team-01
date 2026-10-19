import { CommandError } from "./commands";
import type { Database, Transaction } from "./database";
import { type DeploymentEnvironment, deploymentEnvironment } from "./deployment";

// Durable jobs. Publication takes the domain transaction, so a rolled-back change
// publishes nothing. A worker claims due jobs through app.claim_jobs, which
// leases them under a new fence; processJob then records the outcome, and any
// follow-up the handler publishes, in one transaction guarded by that fence.
// Redelivering a completed job is a no-op, and a stale claim records nothing.

export type JobPublication = {
  readonly kind: string;
  readonly payload?: Record<string, unknown>;
  // One logical job per (kind, dedupeKey); publishing it again does nothing.
  readonly dedupeKey?: string;
  readonly maxAttempts?: number;
  readonly runAfter?: Date;
};

export type ClaimedJob = {
  readonly attempts: number;
  readonly fence: number;
  readonly id: string;
  readonly kind: string;
  readonly maxAttempts: number;
  readonly payload: Record<string, unknown>;
};

export type JobHandler = (tx: Transaction, job: ClaimedJob) => Promise<unknown>;

export type JobResult = "completed" | "duplicate" | "fenced" | "failed" | "exhausted";

export const MAX_CLAIM_BATCH = 25;
export const DEFAULT_LEASE_SECONDS = 120;

export async function publishJob(
  tx: Transaction,
  job: JobPublication,
  environment: DeploymentEnvironment = deploymentEnvironment(),
) {
  const [row] = await tx<{ id: string }[]>`
    insert into app.jobs (kind, payload, dedupe_key, producer_environment, max_attempts, run_after)
    values (
      ${job.kind}, ${tx.json((job.payload ?? {}) as Parameters<typeof tx.json>[0])}, ${job.dedupeKey ?? null},
      ${environment}, ${job.maxAttempts ?? 5}, ${job.runAfter ?? new Date()}
    )
    on conflict (kind, dedupe_key) do nothing
    returning id
  `;

  return row?.id ?? null;
}

export async function claimJobs(
  db: Database,
  options: {
    readonly environment: DeploymentEnvironment;
    readonly kinds: readonly string[];
    readonly owner: string;
    readonly limit?: number;
    readonly leaseSeconds?: number;
  },
): Promise<ClaimedJob[]> {
  if (options.kinds.length === 0) {
    return [];
  }

  const rows = await db<
    { attempts: number; fence: number; id: string; kind: string; max_attempts: number; payload: Record<string, unknown> }[]
  >`
    select id, kind, payload, attempts, max_attempts, fence
    from app.claim_jobs(
      ${options.environment}, ${options.kinds as string[]}, ${options.owner},
      ${Math.min(options.limit ?? MAX_CLAIM_BATCH, MAX_CLAIM_BATCH)}, ${options.leaseSeconds ?? DEFAULT_LEASE_SECONDS}
    )
  `;

  return rows.map((row) => ({
    attempts: row.attempts,
    fence: row.fence,
    id: row.id,
    kind: row.kind,
    maxAttempts: row.max_attempts,
    payload: row.payload,
  }));
}

// Runs a claimed job and records its outcome before the caller acknowledges it.
// The handler's writes, its follow-up jobs and the completion commit together.
export async function processJob(db: Database, job: ClaimedJob, handler: JobHandler): Promise<JobResult> {
  try {
    return (await db.begin(async (tx) => {
      const [current] = await tx<{ fence: number; state: string }[]>`
        select state, fence from app.jobs where id = ${job.id} for update
      `;

      if (current?.state === "completed") {
        return "duplicate";
      }

      if (current?.state !== "running" || current.fence !== job.fence) {
        return "fenced";
      }

      const outcome = await handler(tx, job);

      await tx`
        update app.jobs
        set state = 'completed', outcome = ${tx.json((outcome ?? null) as Parameters<typeof tx.json>[0])},
            failure_category = null, lease_owner = null, lease_expires_at = null,
            completed_at = now(), updated_at = now()
        where id = ${job.id}
      `;

      return "completed";
    })) as JobResult;
  } catch (error) {
    return failJob(db, job, error instanceof CommandError ? error.category : "internal");
  }
}

// Records a failed attempt under the claim's fence: the job is retried after a
// backoff, or left exhausted and visible once its attempts are spent.
async function failJob(db: Database, job: ClaimedJob, category: string): Promise<JobResult> {
  const [row] = await db<{ state: string }[]>`
    update app.jobs
    set state = case when attempts >= max_attempts then 'exhausted' else 'pending' end,
        failure_category = ${category}, lease_owner = null, lease_expires_at = null,
        run_after = now() + make_interval(secs => least(power(2, attempts)::int * 10, 3600)),
        updated_at = now()
    where id = ${job.id} and fence = ${job.fence} and state = 'running'
    returning state
  `;

  if (!row) {
    return "fenced";
  }

  return row.state === "exhausted" ? "exhausted" : "failed";
}
