import { createHostGrantRevokeHandler } from "@lib/server/agent-grant-routes";

const handle = createHostGrantRevokeHandler();

// Revoke in Connected agents.
export function POST(request: Request) {
  return handle(request);
}
