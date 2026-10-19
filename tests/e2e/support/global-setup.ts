import { clearServiceWindow, testDatabase } from "../../integration/support/database";

// Repeated local runs fill the USD 300 service-wide window. It is cleared once,
// before any browser test reserves, so no test clears it under another's feet.
export default async function globalSetup() {
  const db = testDatabase();

  try {
    await clearServiceWindow(db);
  } finally {
    await db.end();
  }
}
