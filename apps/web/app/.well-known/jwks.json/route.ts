import { createJwksHandler, preflight } from "@lib/server/agent-oauth-routes";
import { connection } from "next/server";

const handle = createJwksHandler();

// The public key agent access tokens are verified with.
export async function GET() {
  await connection();
  return handle();
}

export function OPTIONS() {
  return preflight();
}
