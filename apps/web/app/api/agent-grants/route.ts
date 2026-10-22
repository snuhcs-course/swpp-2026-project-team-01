import { createHostGrantListHandler } from "@lib/server/agent-grant-routes";
import { connection } from "next/server";

const handle = createHostGrantListHandler();

// The signed-in host's connected agents.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
