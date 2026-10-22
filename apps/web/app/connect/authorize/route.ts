import { createAuthorizeHandler } from "@lib/server/agent-authorize";
import { connection } from "next/server";

const handle = createAuthorizeHandler();

// The authorization endpoint: validates an agent's request and opens consent.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
