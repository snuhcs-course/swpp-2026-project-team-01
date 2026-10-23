import { createImessageStartHandler, createImessageStartStatusHandler } from "@lib/server/imessage-routes";
import { connection } from "next/server";

const status = createImessageStartStatusHandler();
const start = createImessageStartHandler();

// The iMessage start on the public page: this browser's attempt, before sign-in.
export async function GET(request: Request) {
  await connection();
  return status(request);
}

export function POST(request: Request) {
  return start(request);
}
