import { createAuthorizationServerMetadataHandler, preflight } from "@lib/server/agent-oauth-routes";
import { connection } from "next/server";

const handle = createAuthorizationServerMetadataHandler();

// RFC 8414 metadata for the origin this request was addressed to.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}

export function OPTIONS() {
  return preflight();
}
