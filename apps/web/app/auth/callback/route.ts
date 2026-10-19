import { createGoogleCallbackHandler } from "@lib/server/google-sign-in";
import { connection } from "next/server";

const handle = createGoogleCallbackHandler();

export async function GET(request: Request) {
  // Never prerendered: the response depends on this request and its cookies.
  await connection();
  return handle(request);
}
