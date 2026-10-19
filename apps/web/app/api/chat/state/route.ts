import { createStateHandler } from "@lib/server/chat-routes";
import { connection } from "next/server";

const handle = createStateHandler();

export async function GET(request: Request) {
  // Never prerendered: the response depends on this request's session.
  await connection();
  return handle(request);
}
