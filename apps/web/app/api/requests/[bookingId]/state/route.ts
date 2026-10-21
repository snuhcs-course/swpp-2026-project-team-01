import { createRequesterStateHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterStateHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The requester view of the request, or only its final status once closed.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
