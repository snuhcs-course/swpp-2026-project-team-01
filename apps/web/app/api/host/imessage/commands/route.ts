import { createImessageCommandHandler } from "@lib/server/imessage-routes";

const handle = createImessageCommandHandler();

// A Connect iMessage card's command: create a link code, confirm or cancel it,
// send or verify a fallback code, unlink, or share the contact card.
export function POST(request: Request) {
  return handle(request);
}
