import { createHostResourceMetadataHandler, preflight } from "@lib/server/agent-oauth-routes";
import { connection } from "next/server";

const handle = createHostResourceMetadataHandler();

// RFC 9728 metadata for the host MCP endpoint /mcp.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}

export function OPTIONS() {
  return preflight();
}
