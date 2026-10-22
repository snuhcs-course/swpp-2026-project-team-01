import { createRequesterResourceMetadataHandler, preflight } from "@lib/server/agent-oauth-routes";
import { connection } from "next/server";

const handle = createRequesterResourceMetadataHandler();

// RFC 9728 metadata for a ready host's requester MCP endpoint /{handle}/mcp.
export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  await connection();
  return handle(request, context);
}

export function OPTIONS() {
  return preflight();
}
