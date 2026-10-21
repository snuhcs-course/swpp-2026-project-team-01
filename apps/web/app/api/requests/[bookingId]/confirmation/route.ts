import { createConfirmationStatusHandler, createResendConfirmationHandler } from "@lib/server/confirmation-routes";

const status = createConfirmationStatusHandler();
const resend = createResendConfirmationHandler();

type Context = { params: Promise<{ bookingId: string }> };

// The contact confirmation card: its current status, and **Send the email
// again** through contact.resend_confirmation with the card's retry key.
export function GET(request: Request, context: Context) {
  return status(request, context);
}

export function POST(request: Request, context: Context) {
  return resend(request, context);
}
