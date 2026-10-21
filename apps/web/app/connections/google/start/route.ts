import { createGoogleStartHandler } from "@lib/server/requester-google";
import { connection } from "next/server";

const handle = createGoogleStartHandler();

// A requester's Continue with Google or Connect Google Calendar: the
// application's own consent round trip, separate from host sign-in.
export async function POST(request: Request) {
  await connection();
  return handle(request);
}
