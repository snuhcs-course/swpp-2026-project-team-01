import { createRequestStartHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createRequestStartHandler();

// The guest's first message on a ready host's public page, which starts the
// draft request and its conversation.
export async function POST(request: Request) {
  await connection();
  return handle(request);
}
