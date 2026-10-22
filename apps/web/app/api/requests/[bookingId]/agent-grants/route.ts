import { createRequestGrantListHandler } from "@lib/server/agent-grant-routes";
import { connection } from "next/server";

const handle = createRequestGrantListHandler();

// The agents connected to this request; revocation is the agent.revoke_grant command.
export async function GET(request: Request, context: { params: Promise<{ bookingId: string }> }) {
  await connection();
  return handle(request, context);
}
