import { createHostRequestCommandHandler } from "@lib/server/host-request-routes";

const handle = createHostRequestCommandHandler();

// A host card's command: approve, decline, suggest, share, dismiss, allow a
// trip, waive the weekly limit, find times or check the booking.
export function POST(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return handle(request, context);
}
