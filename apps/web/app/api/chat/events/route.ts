import { createEventsHandler } from "@lib/server/chat-routes";
import { connection } from "next/server";

const handle = createEventsHandler();

// The browser's only read of conversation history and live output. The agent
// still checks the forwarded Supabase session against the session index.
export async function GET(request: Request) {
  await connection();
  return handle(request);
}
