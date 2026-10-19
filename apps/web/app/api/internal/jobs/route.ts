import { createJobWorkerHandler } from "@lib/server/job-worker";

const handle = createJobWorkerHandler();

// Internal: the pg_net wake-up and the pg_cron sweep call this with the shared
// worker secret. A POST handler is never prerendered or cached.
export function POST(request: Request) {
  return handle(request);
}
