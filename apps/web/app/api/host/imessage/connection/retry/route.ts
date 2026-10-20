import { createPhoneLinkRetryHandler } from "@lib/server/imessage-routes";

const handle = createPhoneLinkRetryHandler();

// Asks for another text for the open phone check.
export function POST(request: Request) {
  return handle(request);
}
