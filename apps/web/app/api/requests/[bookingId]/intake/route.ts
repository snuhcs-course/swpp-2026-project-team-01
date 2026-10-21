import { createIntakeTranscriptHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createIntakeTranscriptHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The read-only transcript of the public intake this request came from.
export async function GET(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
