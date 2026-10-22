import { createDecisionHandler } from "@lib/server/agent-authorize";

const handle = createDecisionHandler();

// Allow or Deny on the consent page.
export function POST(request: Request) {
  return handle(request);
}
