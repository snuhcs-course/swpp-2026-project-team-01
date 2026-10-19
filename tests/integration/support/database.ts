import { createDatabase } from "../../../lib/server/database";

// Integration tests run against the disposable local stack started by
// `supabase start`, never against a hosted project.
export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function testDatabase() {
  return createDatabase(process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL);
}

// Suites that run the agent's real model wrapper are bound by the USD 300
// service-wide window, which repeated local runs fill. They clear the current
// window of the disposable local database first; integration files run one at a
// time, so no other suite is reserving meanwhile.
export async function clearServiceWindow(db: ReturnType<typeof testDatabase>) {
  await db`
    delete from app.model_reservations
    where window_start = date_bin('24 hours', statement_timestamp(), timestamptz '2026-01-01 00:00:00+00')
  `;
}
