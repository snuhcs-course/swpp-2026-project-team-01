import { createHostSharedEventsHandler } from "@lib/server/host-request-routes";
import { connection } from "next/server";

const handle = createHostSharedEventsHandler();

// The shared requester conversation, read-only for the host.
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  await connection();
  return handle(request, context);
}
