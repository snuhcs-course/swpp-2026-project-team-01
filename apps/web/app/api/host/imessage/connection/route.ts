import { createPhoneLinkReadHandler, createPhoneLinkStartHandler } from "@lib/server/imessage-routes";
import { connection } from "next/server";

const read = createPhoneLinkReadHandler();
const start = createPhoneLinkStartHandler();

export async function GET(request: Request) {
  // Never prerendered: the response depends on this request's session.
  await connection();
  return read(request);
}

// Starts a phone check: Thyme texts the number and the screen shows the number to send back.
export function POST(request: Request) {
  return start(request);
}
