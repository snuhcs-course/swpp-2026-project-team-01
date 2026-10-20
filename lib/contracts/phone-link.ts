import { z } from "zod";

// What the phone check screens draw while a number is being checked
// (host-imessage-linking). The host enters a number, Thyme texts it, and the
// screen shows a 2-digit number the host sends back in that text conversation.
//   POST /api/host/imessage/connection        { phone: E.164 }  → PhoneLink
//   GET  /api/host/imessage/connection                          → { connection: PhoneLink | null }
//   POST /api/host/imessage/connection/retry                    → PhoneLink
//   POST /api/host/imessage/notify            { channel }        → { channel }
// Each POST carries the action's retry key in the Idempotency-Key header.
// Asking again never waits on the screen: the server takes it and sends the text
// no earlier than a minute after the last one, showing `pending` until then.

export const PHONE_LINK_STATUSES = ["pending", "sent", "uncertain", "connected", "failed", "expired"] as const;
export type PhoneLinkStatus = (typeof PHONE_LINK_STATUSES)[number];

export const PHONE_LINK_FAILURES = [
  "non_imessage_recipient",
  "provider_authentication",
  "provider_rejected",
  "too_many_wrong_replies",
] as const;
export type PhoneLinkFailure = (typeof PHONE_LINK_FAILURES)[number];

// The agreed limits (design §2).
export const CODE_TTL_MS = 5 * 60_000;
export const SEND_SPACING_MS = 60_000;
export const SEND_WINDOW_MS = 5 * 60_000;
export const MAX_SENDS_PER_WINDOW = 5;
export const MAX_WRONG_REPLIES = 3;
export const LOCKOUT_MS = 5 * 60_000;

export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
export const CODE_PATTERN = /^\d{2}$/;

export const phoneLinkSchema = z.object({
  status: z.enum(PHONE_LINK_STATUSES),
  /** Masked, for "Sent to". */
  phone: z.string(),
  /** The newest number to send back, once the text is out. Numbers from earlier sends stay valid until they expire or a wrong reply comes in. */
  code: z.string().regex(CODE_PATTERN).nullable(),
  /** When the newest number stops working (epoch ms). */
  expiresAt: z.number(),
  /** The earliest the next text can go out (asking sooner is fine, it waits); null once no more are allowed, which puts the phone off for now. */
  retryEligibleAt: z.number().nullable(),
  /** Why the check failed: one of PHONE_LINK_FAILURES, or another provider category. */
  failure: z.string().nullable(),
  /**
   * Replies in the conversation that matched no valid number. Each one replaces the number: earlier numbers stop
   * working, `code` is a new one, and `expiresAt` stays as it was. After MAX_WRONG_REPLIES the server fails the
   * check (too_many_wrong_replies) and sets `retryEligibleAt` LOCKOUT_MS ahead; a retry after that sends a new
   * text with a new number and starts the count again.
   */
  wrongReplies: z.number().int().nonnegative(),
});
export type PhoneLink = z.infer<typeof phoneLinkSchema>;

export const phoneLinkReadSchema = z.object({ connection: phoneLinkSchema.nullable() });

export const phoneLinkStartSchema = z.strictObject({ phone: z.string().regex(E164_PATTERN) });

// When texting keeps failing the phone is put off, and the host can ask to hear
// when it works again: `sms` is an iMessage to the number being checked, `email`
// goes to the signed-in Google address.
export const notifyChannelSchema = z.enum(["sms", "email"]);
export type NotifyChannel = z.infer<typeof notifyChannelSchema>;
export const notifyRequestSchema = z.strictObject({ channel: notifyChannelSchema });
