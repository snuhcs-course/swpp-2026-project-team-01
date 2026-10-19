import { createRecoverHandler } from "@lib/server/chat-routes";

const handle = createRecoverHandler();

export function POST(request: Request) {
  return handle(request);
}
