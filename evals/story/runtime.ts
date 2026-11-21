import { randomBytes } from "node:crypto";
import type { BookingDependencies } from "../../lib/server/bookings";
import { createDatabase, type Database } from "../../lib/server/database";
import { createEvaluationHandler, EVALUATION_JOB, type EvaluationDependencies } from "../../lib/server/evaluation";
import { parseTokenKey, type TokenKey } from "../../lib/server/token-encryption";
import { fakeGoogleConfig, runJob } from "../../tests/integration/support/calendar-host";
import { type FakeGoogle, startFakeGoogle } from "../../tests/integration/support/fake-google";
import { FAKE_ROUTES_API_KEY, type FakeRoutes, startFakeRoutes } from "../../tests/integration/support/fake-routes";

// The story evals' runtime (evals/story/README in documentation 12): a fake
// Google Calendar and Routes in this process, the eve dev server pointed at
// them and at the local database, and a worker that runs evaluation jobs of the
// requests these evals seeded. Booking, notice and email jobs never run, so no
// real calendar, inbox or messenger is reached. `eve eval` starts its dev
// server after the config's setup and gives it this process's environment, so
// every variable is set here, before the server reads it.

const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type StoryRuntime = {
  readonly db: Database;
  readonly google: FakeGoogle;
  readonly routes: FakeRoutes;
  readonly tokenKey: TokenKey;
  // Requests these evals seeded: the worker runs only their evaluation jobs.
  readonly owned: Set<string>;
  evaluationDeps(): EvaluationDependencies;
  bookingDeps(): BookingDependencies;
};

// eve bundles the config and each eval file separately, so module state is not
// shared between them; the runtime lives on the process's global object.
type Holder = { runtime: StoryRuntime | null; stopWorker: (() => Promise<void>) | null };
const holder: Holder = ((globalThis as { __fmatStoryRuntime?: Holder }).__fmatStoryRuntime ??= { runtime: null, stopWorker: null });

export function storyRuntime(): StoryRuntime {
  if (!holder.runtime) throw new Error("The story eval runtime is not started; evals/evals.config.ts starts it in setup.");
  return holder.runtime;
}

function localOnly(url: string) {
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`Story evals run only against a local database, not ${host}.`);
  return url;
}

export async function startStoryRuntime(): Promise<StoryRuntime> {
  const url = localOnly(process.env.EVAL_DATABASE_URL ?? LOCAL_DATABASE_URL);
  const encoded = process.env.TOKEN_ENCRYPTION_KEY?.trim() || randomBytes(32).toString("base64");
  const tokenKey = parseTokenKey(encoded);
  const google = await startFakeGoogle();
  const routes = await startFakeRoutes();

  // What the dev server reads: the same database, sealing key, Google and Routes.
  Object.assign(process.env, {
    APP_ORIGIN: process.env.APP_ORIGIN?.trim() || "http://localhost:3000",
    DATABASE_URL: url,
    EVE_INTERNAL_SIGNING_KEY: process.env.EVE_INTERNAL_SIGNING_KEY?.trim() || randomBytes(32).toString("hex"),
    GOOGLE_CALENDAR_API_URL: google.apiBaseUrl,
    GOOGLE_CLIENT_ID: "fake-client-id",
    GOOGLE_CLIENT_SECRET: "fake-client-secret",
    GOOGLE_MAPS_API_KEY: FAKE_ROUTES_API_KEY,
    GOOGLE_OAUTH_TOKEN_URL: google.tokenUrl,
    GOOGLE_ROUTES_API_URL: routes.baseUrl,
    TOKEN_ENCRYPTION_KEY: encoded,
  });

  const db = createDatabase(url);
  const calendar = fakeGoogleConfig(google);
  const evaluationDeps = (): EvaluationDependencies => ({
    calendar,
    db,
    limits: { anonymousWindowUsd: "1000000.00", serviceWindowUsd: "1000000.00" },
    // No ranking model: candidates keep the deterministic order (run settings).
    model: null,
    requesterCalendar: calendar,
    routes: { apiKey: FAKE_ROUTES_API_KEY, baseUrl: routes.baseUrl, timeoutMs: 5_000 },
    tokenKeys: [tokenKey],
  });
  const bookingDeps = (): BookingDependencies => ({
    calendar,
    db,
    evaluation: evaluationDeps(),
    notices: { origin: "http://localhost:3000", tokenKey, tokenKeys: [tokenKey] },
    tokenKeys: [tokenKey],
  });

  const runtime: StoryRuntime = { bookingDeps, db, evaluationDeps, google, owned: new Set(), routes, tokenKey };
  holder.runtime = runtime;
  holder.stopWorker = startEvaluationWorker(runtime);
  return runtime;
}

export async function stopStoryRuntime() {
  const { runtime } = holder;
  if (!runtime) return;
  await holder.stopWorker?.();
  await runtime.google.close();
  await runtime.routes.close();
  await runtime.db.end();
  holder.runtime = null;
  holder.stopWorker = null;
}

// Runs pending evaluation jobs of the owned requests, as the job worker would,
// so evaluate_candidates, apply_request_review and share_changes get real
// results within their wait. Other job kinds are left alone.
function startEvaluationWorker(state: StoryRuntime) {
  const handler = createEvaluationHandler(() => state.evaluationDeps());
  let running = true;
  const loop = (async () => {
    while (running) {
      const owned = [...state.owned];
      if (owned.length > 0) {
        try {
          const jobs = await state.db<{ id: string }[]>`
            select j.id from app.jobs j
            join app.evaluations e on e.id = (j.payload ->> 'evaluationId')::uuid
            where j.kind = ${EVALUATION_JOB} and j.state = 'pending' and e.request_id = any(${owned}::uuid[])
            order by j.created_at
          `;
          for (const job of jobs) await runJob(state.db, job.id, handler).catch(() => undefined);
        } catch {
          // The next pass retries; a stuck evaluation shows as the tool's own timeout.
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}

// Runs one owned request's pending evaluation job now, for fixtures that need
// the result before the conversation starts.
export async function settleEvaluations(requestId: string, timeoutMs = 20_000) {
  const { db } = storyRuntime();
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const [pending] = await db<{ count: number }[]>`
      select count(*)::int as count from app.jobs j
      join app.evaluations e on e.id = (j.payload ->> 'evaluationId')::uuid
      where j.kind = ${EVALUATION_JOB} and j.state in ('pending', 'running') and e.request_id = ${requestId}
    `;
    if (pending!.count === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Evaluations of ${requestId} did not settle within ${timeoutMs} ms.`);
}
