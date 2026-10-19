import type { JobHandler } from "./jobs";

// Handlers by job kind. The worker claims only kinds registered here, so a job
// whose handler is not deployed yet stays pending and visible. Phase 1 publishes
// no jobs; later changes register their kinds here.
export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {};
