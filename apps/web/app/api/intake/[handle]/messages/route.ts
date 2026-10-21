import { createIntakeMessageHandler } from "@lib/server/intake-routes";
import { connection } from "next/server";

const handle = createIntakeMessageHandler();

type Context = { params: Promise<{ handle: string }> };

// A visitor's message on a public host page; the first one starts the tab's intake.
export async function POST(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
