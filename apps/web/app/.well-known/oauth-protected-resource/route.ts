import { createHostResourceMetadataHandler, preflight } from "@lib/server/agent-oauth-routes";
import { connection } from "next/server";

const handle = createHostResourceMetadataHandler();

// The root fallback names the host resource.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}

export function OPTIONS() {
  return preflight();
}
