import { createGroupReviewHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createGroupReviewHandler();

type Context = { params: Promise<{ bookingId: string }> };

// A group participant's unavailable times to confirm.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
