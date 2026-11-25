import { timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { COMMAND_ERROR_MESSAGES, type CommandErrorCategory } from "../contracts/command-errors";
import { database, type Database } from "./database";
import { type DeploymentEnvironment, deploymentEnvironment } from "./deployment";
import { JOB_BATCH_LIMITS, JOB_HANDLERS } from "./job-handlers";
import { type ClaimedJob, claimJobs, type JobHandler, type JobResult, processJob } from "./jobs";
import { messagingAdmitted } from "./messaging";
import { captureServerEvent } from "./product-analytics";
import { TELEGRAM_TYPING_JOB, TYPING_INTERVAL_SECONDS } from "./telegram-jobs";

// The one job worker. The internal route (POST /api/internal/jobs) and
// `npm run jobs:dev` both run a bounded batch through runWorkerBatch: claim due
// jobs of the registered kinds produced by one environment, then process each,
// recording its outcome before the batch answers. A kind with a batch limit is
// claimed on its own, at most that many; the other kinds share one default claim.
// A delivery kind is claimed only where messaging is admitted toward its
// transport's endpoint, so a local worker aimed at a real provider leaves its
// deliveries pending and untouched.

export type JobWorkerDependencies = {
  readonly db: Database;
  // The producer environment whose jobs this worker may claim.
  readonly environment: DeploymentEnvironment;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  // Per-kind claim limits; defaults to JOB_BATCH_LIMITS.
  readonly batchLimits?: Readonly<Record<string, number>>;
  readonly leaseSeconds?: number;
  readonly owner?: string;
  // The process environment the messaging gate reads; process.env by default.
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export type WorkerBatch = {
  readonly claimed: number;
  readonly results: Partial<Record<JobResult, number>>;
};

export async function runWorkerBatch(deps: JobWorkerDependencies): Promise<WorkerBatch> {
  const limits = deps.batchLimits ?? JOB_BATCH_LIMITS;
  const kinds = Object.keys(deps.handlers).filter((kind) => {
    const endpoint = deps.handlers[kind]!.messagingEndpoint;
    return !endpoint || messagingAdmitted(endpoint(), deps.env);
  });
  const claims = [
    ...kinds.filter((kind) => limits[kind] !== undefined).map((kind) => ({ kinds: [kind], limit: limits[kind] })),
    { kinds: kinds.filter((kind) => limits[kind] === undefined), limit: undefined },
  ];
  const jobs: ClaimedJob[] = [];

  for (const claim of claims) {
    jobs.push(
      ...(await claimJobs(deps.db, {
        environment: deps.environment,
        kinds: claim.kinds,
        leaseSeconds: deps.leaseSeconds,
        limit: claim.limit,
        owner: deps.owner ?? `${hostname()}:${process.pid}`,
      })),
    );
  }
  const results: Partial<Record<JobResult, number>> = {};

  for (const job of jobs) {
    let result: JobResult;

    try {
      result = await processJob(deps.db, job, deps.handlers[job.kind]!);
    } catch (error) {
      // Recording the failure itself failed: the lease expires and the job is
      // reclaimed under a new fence, while the rest of the batch still runs.
      // Only the error's class: its message or cause can carry provider details.
      console.error("job worker could not record a job outcome", {
        error: error instanceof Error ? error.name : typeof error,
        jobId: job.id,
        kind: job.kind,
      });
      result = "failed";
    }

    results[result] = (results[result] ?? 0) + 1;
    // A job's kind and result, such as a booking written to the calendar.
    captureServerEvent({ event: "job_processed", properties: { attempt: job.attempts, kind: job.kind, result }, subject: { kind: "anonymous", scope: "job" } }, deps.env);
  }

  return { claimed: jobs.length, results };
}

// Constant-time comparison of the bearer against the shared worker secret.
export function hasWorkerSecret(request: Request, secret: string) {
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);

  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function refusal(category: CommandErrorCategory, status: number) {
  return Response.json(
    { error: { category, message: COMMAND_ERROR_MESSAGES[category] } },
    { headers: { "cache-control": "no-store" }, status },
  );
}

export type JobRouteDependencies = Omit<JobWorkerDependencies, "environment"> & {
  readonly env: Readonly<Record<string, string | undefined>>;
  // WORKER_SECRET; at least 32 characters, as the deploy workflow requires of the
  // Vault copy.
  readonly secret: string | undefined;
};

function routeDependenciesFromEnvironment(): JobRouteDependencies {
  return { db: database(), env: process.env, handlers: JOB_HANDLERS, secret: process.env.WORKER_SECRET };
}

// POST /api/internal/jobs. Called by the pg_net wake-up and the pg_cron sweep
// with the shared secret from Vault. It runs only on the production deployment
// (VERCEL=1 with VERCEL_ENV=production) and claims only production-produced
// jobs, so a preview sharing the database leaves preview jobs unclaimed and
// visible. Every refusal happens before job state is read.
export function createJobWorkerHandler(
  load: () => JobRouteDependencies = routeDependenciesFromEnvironment,
  afterResponse?: (task: () => Promise<void>) => void,
) {
  return async (request: Request) => {
    const deps = load();

    if (deploymentEnvironment(deps.env) !== "production") {
      return refusal("unavailable_configuration", 503);
    }

    if (!deps.secret || deps.secret.length < 32) {
      return refusal("unavailable_configuration", 503);
    }

    if (!hasWorkerSecret(request, deps.secret)) {
      return refusal("unauthenticated", 401);
    }

    const worker = { ...deps, environment: "production" as const };
    const typing = deps.handlers[TELEGRAM_TYPING_JOB];
    if (typing) {
      afterResponse?.(() => runScheduledTyping({ ...worker, handlers: { [TELEGRAM_TYPING_JOB]: typing } }));
    }
    const batch = await runWorkerBatch(worker);
    return Response.json(batch, { headers: { "cache-control": "no-store" } });
  };
}

// Publishing a refresh wakes the worker before run_after. Check the pending
// refreshes after acknowledging that wake-up, within one typing interval.
// Later refreshes publish their own wake-ups; the minute sweep still recovers lost ones.
async function runScheduledTyping(deps: JobWorkerDependencies) {
  const deadline = new Date(Date.now() + TYPING_INTERVAL_SECONDS * 1000);
  while (Date.now() < deadline.getTime()) {
    const [next] = await deps.db<{ delay_ms: number }[]>`
      select greatest(0, ceil(extract(epoch from run_after - now()) * 1000))::int as delay_ms
      from app.jobs
      where producer_environment = ${deps.environment} and kind = ${TELEGRAM_TYPING_JOB}
        and state = 'pending' and run_after <= ${deadline}
      order by run_after
      limit 1
    `;
    if (!next) return;
    if (next.delay_ms > 0) await delay(next.delay_ms);
    await runWorkerBatch(deps);
  }
}
