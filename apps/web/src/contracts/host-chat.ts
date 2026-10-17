// AI-generated with Claude Code (claude-opus-5-5), 2026-10-17
import { z } from "zod"
import { revisionSchema, textSchema } from "./common"
import { localeSchema } from "./profile"

// The host's web chat with Thyme (/app). The screen draws only what this view says: Thyme's and the host's
// messages, a card on a message, and the suggested replies. What Thyme asks, in what order, and when setup is
// done all live behind GET and POST /api/host-chat, so the conversation can change without touching the screen.

/** Something drawn under a message instead of words. `link`: the host's booking link, an app path. */
export const chatCardSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("link"), path: z.string().startsWith("/") }),
])
export const chatMessageSchema = z.strictObject({
  id: z.string().min(1),
  from: z.enum(["thyme", "host"]),
  text: z.string(),
  card: chatCardSchema.optional(),
})
/** A suggested reply. With `href` the screen opens that app path; without it the screen sends `{ reply: id }`. */
export const chatReplySchema = z.strictObject({ id: z.string().min(1).max(64), label: z.string().min(1), href: z.string().startsWith("/").optional() })
export const hostChatViewSchema = z.strictObject({
  messages: z.array(chatMessageSchema),
  replies: z.array(chatReplySchema),
  /** Sent back with the next message, so a change made in another tab is noticed instead of overwritten. Null before the first message. */
  revision: revisionSchema.nullable(),
})
/** One thing the host does: types a message or picks a suggested reply. Sent with an Idempotency-Key; a retry with the same key is applied once. */
export const hostChatSendSchema = z.strictObject({
  revision: revisionSchema.nullable(),
  text: textSchema.optional(),
  reply: z.string().min(1).max(64).optional(),
  locale: localeSchema,
}).refine((input) => (input.text === undefined) !== (input.reply === undefined), "Send either text or a reply")

export type ChatCard = z.infer<typeof chatCardSchema>
export type ChatMessage = z.infer<typeof chatMessageSchema>
export type ChatReply = z.infer<typeof chatReplySchema>
export type HostChatView = z.infer<typeof hostChatViewSchema>
export type HostChatSend = z.infer<typeof hostChatSendSchema>
