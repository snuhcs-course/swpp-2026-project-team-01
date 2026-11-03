import { createRequesterImessageStatusHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const status = createRequesterImessageStatusHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The Get updates in iMessage card's status; its commands use the commands route.
export async function GET(request: Request, context: Context) {
  await connection();
  return status(request, context);
}
