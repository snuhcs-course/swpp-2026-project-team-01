import { createLinkResendRouteHandler } from "@lib/server/link-resend";

const handle = createLinkResendRouteHandler();

// **Resend my booking link**: the same generic acceptance for every address; the
// matching and the email happen later in the link_resend job.
export function POST(request: Request) {
  return handle(request);
}
