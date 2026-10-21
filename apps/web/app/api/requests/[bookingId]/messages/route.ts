import { createRequesterMessageHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterMessageHandler();

type Context = { params: Promise<{ bookingId: string }> };

// A requester's message in the request conversation.
export async function POST(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
