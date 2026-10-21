import { createRequesterMessageHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequesterMessageHandler();

type Context = { params: Promise<{ bookingId: string }> };

// A guest message in the request conversation, a draft included.
export async function POST(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
