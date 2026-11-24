import { createSentRequestConversationHandler } from "@lib/server/host-request-routes";
import { connection } from "next/server";

const handle = createSentRequestConversationHandler();

type Context = { params: Promise<{ requestId: string }> };

// The signed-in account's own conversation of a request it sent, read only
// (guest-account-history D2).
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
