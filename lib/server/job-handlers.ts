import { EMAIL_RECEIPT_JOB } from "./agentmail-receiver";
import { CALENDAR_ANALYSIS_JOB, createCalendarAnalysisHandler } from "./analysis";
import { BOOKING_JOB, BOOKING_PENDING_JOB, createBookingHandler, createBookingPendingHandler } from "./bookings";
import { createEmailDeliveryHandler, EMAIL_DELIVERY_JOB } from "./email-delivery";
import { createEmailReceiptHandler } from "./email-receipts";
import { createEmailReplyHandler, EMAIL_REPLY_JOB } from "./email-replies";
import { createEvaluationHandler, EVALUATION_JOB } from "./evaluation";
import { createImessageSendHandler, IMESSAGE_SEND_JOB } from "./imessage-outbox";
import { createImessageNoticeHandler } from "./imessage-notice-job";
import { IMESSAGE_NOTICE_JOB, TELEGRAM_BUTTONS_JOB } from "./imessage-notices";
import { createImessageReceiptHandler } from "./imessage-receipts";
import type { JobHandler } from "./jobs";
import { createLinkResendHandler, LINK_RESEND_JOB } from "./link-resend";
import { createNoteWritebackHandler, NOTE_WRITEBACK_JOB } from "./note-decisions";
import { createWeeklyNoteCheckHandler, createWeeklyNoteListHandler, createWeeklyNoteReviewHandler } from "./note-weekly-check";
import { WEEKLY_NOTE_CHECK_JOB, WEEKLY_NOTE_LIST_JOB, WEEKLY_NOTE_REVIEW_JOB } from "./note-weekly-store";
import { ONBOARDING_SLOT_IMAGE_JOB } from "./onboarding-note-step";
import { IMESSAGE_RECEIPT_JOB } from "./photon-receiver";
import { createRequestExpiryHandler, REQUEST_EXPIRY_JOB } from "./request-lifecycle";
import { createOnboardingSlotImageHandler } from "./setup-channel-tools";
import { createTelegramButtonsHandler, createTelegramTypingHandler, TELEGRAM_TYPING_JOB } from "./telegram-jobs";

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
  [IMESSAGE_NOTICE_JOB]: createImessageNoticeHandler(),
  [IMESSAGE_RECEIPT_JOB]: createImessageReceiptHandler(),
  [IMESSAGE_SEND_JOB]: createImessageSendHandler(),
  [LINK_RESEND_JOB]: createLinkResendHandler(),
  [NOTE_WRITEBACK_JOB]: createNoteWritebackHandler(),
  [ONBOARDING_SLOT_IMAGE_JOB]: createOnboardingSlotImageHandler(),
  [REQUEST_EXPIRY_JOB]: createRequestExpiryHandler(),
  [TELEGRAM_BUTTONS_JOB]: createTelegramButtonsHandler(),
  [TELEGRAM_TYPING_JOB]: createTelegramTypingHandler(),
  [WEEKLY_NOTE_CHECK_JOB]: createWeeklyNoteCheckHandler(),
  [WEEKLY_NOTE_LIST_JOB]: createWeeklyNoteListHandler(),
  [WEEKLY_NOTE_REVIEW_JOB]: createWeeklyNoteReviewHandler(),
};

// The most jobs of a kind one worker batch claims; kinds not listed share the
// default batch. A Calendar analysis may read Google for up to 30 seconds and then
// ask the note classifier (two 30-second calls at most), so one fits
// within the 120-second lease; an evaluation stops at its 18-second deadline,
// so four do; a booking revalidates under that deadline and then writes with a
// 10-second timeout, so three do. An email receipt may read AgentMail and then
// deliver into a conversation (25 seconds at most), so four do. An iMessage
// receipt may deliver into a conversation (25 seconds at most), so four of those
// do; a send can wait on three 20-second steps (client, conversation, send), so
// two do. A note writeback exchanges the token and patches one event, each
// with a 10-second timeout, so five do. An onboarding slot image reads the
// conflict calendars for next week, each read with its own timeout, so two do.
// A weekly note list re-sent on WhatsApp may read the listed calendars, so two
// do; the weekly check and its review only read the database.
export const JOB_BATCH_LIMITS: Readonly<Record<string, number>> = {
  [WEEKLY_NOTE_LIST_JOB]: 2,
  [BOOKING_JOB]: 3,
  [CALENDAR_ANALYSIS_JOB]: 1,
  [EMAIL_RECEIPT_JOB]: 4,
  [EVALUATION_JOB]: 4,
  [IMESSAGE_RECEIPT_JOB]: 4,
  [IMESSAGE_SEND_JOB]: 2,
  [NOTE_WRITEBACK_JOB]: 5,
  [ONBOARDING_SLOT_IMAGE_JOB]: 2,
};
