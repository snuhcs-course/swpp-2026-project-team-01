import { EMAIL_RECEIPT_JOB } from "./agentmail-receiver";
import { CALENDAR_ANALYSIS_JOB, createCalendarAnalysisHandler } from "./analysis";
import { BOOKING_JOB, BOOKING_PENDING_JOB, createBookingHandler, createBookingPendingHandler } from "./bookings";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "./email-delivery";
import { createEmailReceiptHandler } from "./email-receipts";
import { createEmailReplyHandler, EMAIL_REPLY_JOB } from "./email-replies";
import { createEvaluationHandler, EVALUATION_JOB } from "./evaluation";
import { createImessageSendHandler, IMESSAGE_SEND_JOB } from "./imessage-outbox";
import { createImessageReceiptHandler } from "./imessage-receipts";
import type { JobHandler } from "./jobs";
import { createLinkResendHandler, LINK_RESEND_JOB } from "./link-resend";
import { IMESSAGE_RECEIPT_JOB } from "./photon-receiver";
import { createRequestExpiryHandler, REQUEST_EXPIRY_JOB } from "./request-lifecycle";

// Handlers by job kind. The worker claims only kinds registered here, so a job
// whose handler is not deployed yet stays pending and visible.
export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
  [BOOKING_JOB]: createBookingHandler(),
  [BOOKING_PENDING_JOB]: createBookingPendingHandler(),
  [CALENDAR_ANALYSIS_JOB]: createCalendarAnalysisHandler(),
  [EMAIL_DELIVERY_JOB]: createEmailDeliveryHandler(),
  [EMAIL_RECEIPT_JOB]: createEmailReceiptHandler(),
  [EMAIL_REPLY_JOB]: createEmailReplyHandler(),
  [EVALUATION_JOB]: createEvaluationHandler(),
  [IMESSAGE_RECEIPT_JOB]: createImessageReceiptHandler(),
  [IMESSAGE_SEND_JOB]: createImessageSendHandler(),
  [LINK_RESEND_JOB]: createLinkResendHandler(),
  [REQUEST_EXPIRY_JOB]: createRequestExpiryHandler(),
};

// The most jobs of a kind one worker batch claims; kinds not listed share the
// default batch. A Calendar analysis may read Google for up to 30 seconds, so two
// fit within the 120-second lease; an evaluation stops at its 18-second deadline,
// so four do; a booking revalidates under that deadline and then writes with a
// 10-second timeout, so three do. An email receipt may read AgentMail and then
// deliver into a conversation (25 seconds at most), so four do. An iMessage send
// opens a Spectrum client and sends within 20 seconds each, and an iMessage
// receipt may deliver into a conversation (25 seconds at most), so four of each do.
export const JOB_BATCH_LIMITS: Readonly<Record<string, number>> = {
  [BOOKING_JOB]: 3,
  [CALENDAR_ANALYSIS_JOB]: 2,
  [EMAIL_RECEIPT_JOB]: 4,
  [EVALUATION_JOB]: 4,
  [IMESSAGE_RECEIPT_JOB]: 4,
  [IMESSAGE_SEND_JOB]: 4,
};
