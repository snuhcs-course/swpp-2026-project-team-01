import { createRequesterBusyHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterBusyHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The guest's own busy times for the Choose a time grid.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
