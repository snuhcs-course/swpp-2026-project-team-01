import { createIntakeEventsHandler } from "@lib/server/intake-routes";
import { connection } from "next/server";

const handle = createIntakeEventsHandler();

type Context = { params: Promise<{ handle: string }> };

// The intake conversation's history and live output, read by the application, never by the browser from /eve/v1.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
