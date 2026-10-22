import { createHostRequestListHandler } from "@lib/server/host-request-routes";
import { connection } from "next/server";

const handle = createHostRequestListHandler();

// The host's request inbox in /app.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
