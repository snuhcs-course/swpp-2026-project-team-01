import { createRequesterCalendarsHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterCalendarsHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The requester's own calendar list for the selection card.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
