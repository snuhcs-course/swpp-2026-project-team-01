import { createNotifyWhenBackHandler } from "@lib/server/imessage-routes";

const handle = createNotifyWhenBackHandler();

// Records that the host wants to hear when texting works again.
export function POST(request: Request) {
  return handle(request);
}
