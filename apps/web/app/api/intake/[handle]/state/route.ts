import { createIntakeStateHandler } from "@lib/server/intake-routes";
import { connection } from "next/server";

const handle = createIntakeStateHandler();

type Context = { params: Promise<{ handle: string }> };

// Whether the tab's intake is open, and its conversation's status.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
