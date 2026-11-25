import { markdownRewrite, updateSession } from "@lib/server/session-proxy";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return markdownRewrite(request) ?? updateSession(request);
}

export const config = {
  // Every page and route except static assets, the agent service's own paths,
  // the public entry documents, the agent protocol endpoints (discovery, OAuth
  // and MCP), which never touch the session, and the analytics relay (/ingest).
  matcher: [
    "/((?!_next/static|_next/image|eve/|ingest/|icon.svg|apple-icon|eve.svg|SKILL\\.md$|llms\\.txt$|[^/]+/SKILL\\.md$|\\.well-known/|oauth/|mcp$|[^/]+/mcp$).*)",
  ],
};
