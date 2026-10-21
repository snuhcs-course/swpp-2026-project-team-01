import { createConfirmContactHandler } from "@lib/server/confirmation-routes";

const confirm = createConfirmContactHandler();

// **Confirm this address** from the creation email's confirmation page, with
// the token in the body.
export function POST(request: Request) {
  return confirm(request);
}
