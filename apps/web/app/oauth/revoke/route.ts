import { createRevocationHandler, preflight } from "@lib/server/agent-oauth-routes";

const handle = createRevocationHandler();

// Token revocation (RFC 7009).
export function POST(request: Request) {
  return handle(request);
}

export function OPTIONS() {
  return preflight();
}
