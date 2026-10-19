import { createMessageHandler } from "@lib/server/chat-routes";

const handle = createMessageHandler();

// The only way a browser message reaches the agent: authenticated, checked for
// eligibility and recorded as an accepted input first.
export function POST(request: Request) {
  return handle(request);
}
