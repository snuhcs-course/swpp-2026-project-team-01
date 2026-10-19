import { updateSession } from "@lib/server/session-proxy";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Every page and route except static assets and the agent service's own paths.
  matcher: ["/((?!_next/static|_next/image|eve/|icon.svg|apple-icon|eve.svg|paper-grain.svg).*)"],
};
