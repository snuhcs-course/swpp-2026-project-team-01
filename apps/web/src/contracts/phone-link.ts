// AI-generated with Claude Code (claude-opus-5-5), 2026-10-18
import { z } from "zod"

// What the phone screens draw while a number is being checked. The screen asks for a number, Thyme texts it,
// and the screen shows a 2-digit number the host sends back in that text conversation. The server answers
//   POST /api/host/imessage/connection        { phone: E.164 }  → PhoneLink
//   GET  /api/host/imessage/connection                          → { connection: PhoneLink | null }
//   POST /api/host/imessage/connection/retry                    → PhoneLink
// Asking again (POST with the same or another number, or retry) never waits on the screen: the server takes it
// and sends the text no earlier than a minute after the last one, showing `pending` until then.
// Field names follow the iMessage backend's connection status; `code` and `wrongReplies` are new.
export const phoneLinkSchema = z.object({
  status: z.enum(["pending", "sent", "uncertain", "connected", "failed", "expired"]),
  /** Masked, for "Sent to". */
  phone: z.string(),
  /** The newest number to send back, once the text is out. Numbers from earlier sends stay valid until they expire or a wrong reply comes in. */
  code: z.string().regex(/^\d{2}$/).nullable(),
  /** When the newest number stops working (epoch ms). */
  expiresAt: z.number(),
  /** The earliest the next text can go out (asking sooner is fine, it waits); null once no more are allowed, which puts the phone off for now. */
  retryEligibleAt: z.number().nullable(),
  /** Why the check failed: non_imessage_recipient, provider_authentication, provider_rejected, too_many_wrong_replies, … */
  failure: z.string().nullable(),
  /**
   * Replies in the conversation that matched no valid number. Each one replaces the number: earlier numbers stop
   * working, `code` is a new one, and `expiresAt` stays as it was. The numbers are only 2 digits, so after 3 wrong
   * replies the server fails the check (too_many_wrong_replies) and sets `retryEligibleAt` a few minutes ahead;
   * a retry after that sends a new text with a new number and starts the count again.
   */
  wrongReplies: z.number().int().nonnegative(),
})
export type PhoneLink = z.infer<typeof phoneLinkSchema>

export const phoneLinkReadSchema = z.object({ connection: phoneLinkSchema.nullable() })

// When texting keeps failing the phone is put off, and the host can ask to hear when it works again.
// The server already knows where: the number being checked, or the signed-in Google address.
//   POST /api/host/imessage/notify  { channel }  → { channel }
export const notifyChannelSchema = z.enum(["sms", "email"])
export type NotifyChannel = z.infer<typeof notifyChannelSchema>
export const notifyRequestSchema = z.strictObject({ channel: notifyChannelSchema })
