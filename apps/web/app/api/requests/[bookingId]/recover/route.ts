import { createRequesterRecoverHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterRecoverHandler();

type Context = { params: Promise<{ bookingId: string }> };

// **Recover conversation**: a new generation after a confirmed runtime failure.
export async function POST(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
