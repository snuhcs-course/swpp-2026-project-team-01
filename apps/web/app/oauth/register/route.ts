import { createRegistrationHandler, preflight } from "@lib/server/agent-oauth-routes";

const handle = createRegistrationHandler();

// Dynamic client registration (RFC 7591).
export function POST(request: Request) {
  return handle(request);
}

export function OPTIONS() {
  return preflight();
}
