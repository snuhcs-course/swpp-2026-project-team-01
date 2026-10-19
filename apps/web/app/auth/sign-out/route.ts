import { createSignOutHandler } from "@lib/server/google-sign-in";

const handle = createSignOutHandler();

export function POST(request: Request) {
  return handle(request);
}
