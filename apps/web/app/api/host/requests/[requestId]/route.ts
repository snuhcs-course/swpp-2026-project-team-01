import { createHostRequestHandler } from "@lib/server/host-request-routes";
import { connection } from "next/server";

const handle = createHostRequestHandler();

// One request as its host sees it.
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  await connection();
  return handle(request, context);
}
