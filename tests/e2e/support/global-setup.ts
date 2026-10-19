import { clearServiceWindow, testDatabase } from "../../integration/support/database";

// Repeated local runs fill the USD 300 service-wide model window, and the
// integration suites fill the 100-per-day service-wide sign-up bound. Both are
// cleared once, before any browser test reserves or signs up, so no test clears
// them under another's feet. Only the local stack is ever used here.
export default async function globalSetup() {
  const db = testDatabase();

  try {
    await clearServiceWindow(db);
    await db`delete from app.signup_attempts`;
  } finally {
    await db.end();
  }
}
