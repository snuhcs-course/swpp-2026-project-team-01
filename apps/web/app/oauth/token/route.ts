import { createTokenHandler, preflight } from "@lib/server/agent-oauth-routes";

const handle = createTokenHandler();

// The token endpoint: authorization_code and refresh_token for public clients.
export function POST(request: Request) {
  return handle(request);
}

export function OPTIONS() {
  return preflight();
}
