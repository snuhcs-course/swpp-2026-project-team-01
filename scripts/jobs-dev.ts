// `npm run jobs:dev`: the job worker for local development. It runs outside
// Vercel against the teammate's own database (DATABASE_URL), claims only jobs
// that local processes produced, and refuses to point at a hosted team project.
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { database } from "../lib/server/database";
import { deploymentEnvironment } from "../lib/server/deployment";
import { JOB_HANDLERS } from "../lib/server/job-handlers";
import { runWorkerBatch } from "../lib/server/job-worker";

// The shared project is changed only by CI; the reserved release project is not
// for development at all.
export const PROTECTED_PROJECT_REFS = ["anelszynxtvxoxqvzgqt", "mriseqztcwmezvtawnbo"];

export function devWorkerRefusal(env: Readonly<Record<string, string | undefined>>) {
  const ref = env.SUPABASE_PROJECT_REF?.trim() ?? "";
  const url = env.DATABASE_URL ?? "";

  if (PROTECTED_PROJECT_REFS.some((protectedRef) => ref === protectedRef || url.includes(protectedRef))) {
    return "jobs:dev refuses a shared or reserved Supabase project; point SUPABASE_PROJECT_REF and DATABASE_URL at your own sandbox or the local stack.";
  }

  if (deploymentEnvironment(env) !== "local") {
    return "jobs:dev runs only outside Vercel.";
  }

  if (!url) {
    return "DATABASE_URL is not set.";
  }

  return null;
}

async function main() {
  const refusal = devWorkerRefusal(process.env);

  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  const db = database();
  const owner = `jobs-dev:${hostname()}:${process.pid}`;
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });

  console.log(`jobs:dev polling every 5 s for local jobs of ${Object.keys(JOB_HANDLERS).length} registered kinds.`);

  while (!stopping) {
    const batch = await runWorkerBatch({ db, environment: "local", handlers: JOB_HANDLERS, owner });

    if (batch.claimed > 0) {
      console.log(JSON.stringify(batch));
    } else {
      await sleep(5000);
    }
  }

  await db.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
