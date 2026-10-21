import { createRequesterCommandHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterCommandHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The booking page's card commands, each with its expected revision and retry key.
export async function POST(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
