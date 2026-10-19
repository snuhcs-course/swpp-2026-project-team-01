import { timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { COMMAND_ERROR_MESSAGES, type CommandErrorCategory } from "../contracts/command-errors";
import { database, type Database } from "./database";
import { type DeploymentEnvironment, deploymentEnvironment } from "./deployment";
import { JOB_HANDLERS } from "./job-handlers";
import { claimJobs, type JobHandler, type JobResult, processJob } from "./jobs";

// The one job worker. The internal route (POST /api/internal/jobs) and
// `npm run jobs:dev` both run a bounded batch through runWorkerBatch: claim due
// jobs of the registered kinds produced by one environment, then process each,
// recording its outcome before the batch answers.

export type JobWorkerDependencies = {
  readonly db: Database;
  // The producer environment whose jobs this worker may claim.
  readonly environment: DeploymentEnvironment;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly leaseSeconds?: number;
  readonly owner?: string;
};

export type WorkerBatch = {
  readonly claimed: number;
  readonly results: Partial<Record<JobResult, number>>;
};

export async function runWorkerBatch(deps: JobWorkerDependencies): Promise<WorkerBatch> {
  const jobs = await claimJobs(deps.db, {
    environment: deps.environment,
    kinds: Object.keys(deps.handlers),
    leaseSeconds: deps.leaseSeconds,
    owner: deps.owner ?? `${hostname()}:${process.pid}`,
  });
  const results: Partial<Record<JobResult, number>> = {};

  for (const job of jobs) {
    let result: JobResult;

    try {
      result = await processJob(deps.db, job, deps.handlers[job.kind]!);
    } catch (error) {
      // Recording the failure itself failed: the lease expires and the job is
      // reclaimed under a new fence, while the rest of the batch still runs.
      console.error("job worker could not record a job outcome", { error, jobId: job.id, kind: job.kind });
      result = "failed";
    }

    results[result] = (results[result] ?? 0) + 1;
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
export function createJobWorkerHandler(load: () => JobRouteDependencies = routeDependenciesFromEnvironment) {
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

    const batch = await runWorkerBatch({ ...deps, environment: "production" });
    return Response.json(batch, { headers: { "cache-control": "no-store" } });
  };
}
