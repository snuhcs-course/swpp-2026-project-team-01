import { createIntakeContinueHandler } from "@lib/server/intake-routes";
import { connection } from "next/server";

const handle = createIntakeContinueHandler();

type Context = { params: Promise<{ handle: string }> };

// Continue without Google: creates the intake's one request and answers its booking link.
export async function POST(request: Request, context: Context) {
  await connection();
  return handle(request, context);
}
