import { createSetupStateHandler } from "@lib/server/setup-routes";
import { connection } from "next/server";

const handle = createSetupStateHandler();

export async function GET(request: Request) {
  // Never prerendered: the response depends on this request's session.
  await connection();
  return handle(request);
}
