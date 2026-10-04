import type { Actor, Database } from '../_shared/database.ts';
import type { Environment } from '../_shared/env.ts';
import { DomainError, errorResponse } from '../_shared/errors.ts';
import { constantTimeEqual } from '../_shared/security.ts';
export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  leaseToken: string;
  attempts: number;
}
export type JobHandler = (job: Job, actor: Actor & { kind: 'worker'; id: string }) => Promise<void>;
export function createWorker(
  env: Environment,
  database: Database,
  handlers: Record<string, JobHandler> = {},
) {
  return async (request: Request): Promise<Response> => {
    const correlationId = crypto.randomUUID();
    try {
      if (request.method !== 'POST') throw new DomainError('not_found', 404);
      if (
        !await constantTimeEqual(request.headers.get('x-worker-secret') || '', env.workerSecret)
      ) throw new DomainError('unauthorized', 401);
      const workerId = crypto.randomUUID();
      const { jobs } = await database.command<{ jobs: Job[] }>('jobs_claim', {
        kind: 'worker',
        id: workerId,
      }, {
        workerId,
        limit: 1,
      });
      let completed = 0;
      for (const job of jobs) {
        try {
          if (job.kind !== 'ping') {
            if (!handlers[job.kind]) throw new DomainError('unsupported_job');
            await handlers[job.kind](job, { kind: 'worker', id: workerId });
          }
          await database.command('jobs_complete', { kind: 'worker', id: workerId }, {
            jobId: job.id,
            leaseToken: job.leaseToken,
          });
          completed++;
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'provider_unavailable';
          await database.command('jobs_fail', { kind: 'worker', id: workerId }, {
            jobId: job.id,
            leaseToken: job.leaseToken,
            errorCode: code,
            retryAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 8)))
              .toISOString(),
          });
        }
      }
      return Response.json({ claimed: jobs.length, completed });
    } catch (error) {
      return errorResponse(error, correlationId);
    }
  };
}
