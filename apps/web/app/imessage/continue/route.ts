import { createImessageContinueHandler } from "@lib/server/imessage-routes";
import { connection } from "next/server";

const handle = createImessageContinueHandler();

// The sign-in link in Thyme's iMessage reply (D19).
export async function GET(request: Request) {
  // Never prerendered: the response depends on this request's token.
  await connection();
  return handle(request);
}
