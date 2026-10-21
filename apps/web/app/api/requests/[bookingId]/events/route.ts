import { createRequesterEventsHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterEventsHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The request conversation's history and live output, read by the application with an internal bearer.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
