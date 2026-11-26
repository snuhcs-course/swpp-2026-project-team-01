import { createGroupStartHandler } from "@lib/server/requester-routes";
import { connection } from "next/server";

const handle = createGroupStartHandler();

// **Continue with Google** on a group meeting's shared link, which starts the
// participant's draft request in the group.
export async function POST(request: Request) {
  await connection();
  return handle(request);
}
