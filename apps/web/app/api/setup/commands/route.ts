import { createSetupCommandHandler } from "@lib/server/setup-routes";

const handle = createSetupCommandHandler();

// Every setup card action: authenticated, checked for eligibility and run through
// the command pipeline with the card's retry key and expected revision.
export function POST(request: Request) {
  return handle(request);
}
