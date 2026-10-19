import { createDatabase } from "../../../lib/server/database";

// Integration tests run against the disposable local stack started by
// `supabase start`, never against a hosted project.
export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export function testDatabase() {
  return createDatabase(process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL);
}
