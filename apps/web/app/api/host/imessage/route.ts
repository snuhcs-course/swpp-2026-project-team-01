import { createImessageStatusHandler } from "@lib/server/imessage-routes";
import { connection } from "next/server";

const handle = createImessageStatusHandler();

// The Connect iMessage card's status in /app.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
