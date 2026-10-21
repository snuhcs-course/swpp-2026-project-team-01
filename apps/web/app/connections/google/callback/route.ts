import { createGoogleCallbackHandler } from "@lib/server/requester-google";
import { connection } from "next/server";

const handle = createGoogleCallbackHandler();

// Google's return for a requester consent. Its Location can carry a booking
// link, so every response is no-referrer, no-store and noindex.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
