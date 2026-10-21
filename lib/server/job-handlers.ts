import { CALENDAR_ANALYSIS_JOB, createCalendarAnalysisHandler } from "./analysis";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "./email-delivery";
import type { JobHandler } from "./jobs";
import { createLinkResendHandler, LINK_RESEND_JOB } from "./link-resend";

// Handlers by job kind. The worker claims only kinds registered here, so a job
// whose handler is not deployed yet stays pending and visible.
export const JOB_HANDLERS: Readonly<Record<string, JobHandler>> = {
  [CALENDAR_ANALYSIS_JOB]: createCalendarAnalysisHandler(),
  [EMAIL_DELIVERY_JOB]: createEmailDeliveryHandler(),
  [LINK_RESEND_JOB]: createLinkResendHandler(),
};

// The most jobs of a kind one worker batch claims; kinds not listed share the
// default batch. A Calendar analysis may read Google for up to 30 seconds, so two
// fit within the 120-second lease.
export const JOB_BATCH_LIMITS: Readonly<Record<string, number>> = {
  [CALENDAR_ANALYSIS_JOB]: 2,
};
