import type { RequestLanguage } from "../contracts/request";
import type { Queryable } from "./database";

// The language of the fixed replies in a linked conversation
// (channel-actions-in-words D4). Fixed replies are written in English and
// Korean, the languages the product ships; Thyme answers free text in any
// language. A message with Hangul is Korean and one with other letters is
// English. A message that says nothing about its language, such as a command
// word, a button tap or a link code, follows the conversation: the host's
// latest message to Thyme in any of their discussions, else English.

const HANGUL = /[가-힣]/;
const LETTER = /\p{L}/u;
const CHANNEL_PREFIX = /^\[(?:iMessage|WhatsApp|Telegram)\] /;

export type ChannelLanguage = RequestLanguage;

// The language a text shows, or null when it shows none.
export function textLanguage(text: string | null | undefined): ChannelLanguage | null {
  const body = (text ?? "").replace(CHANNEL_PREFIX, "");
  if (HANGUL.test(body)) return "ko";
  return LETTER.test(body) ? "en" : null;
}

// The language of the host's conversation, from their latest message to Thyme.
export async function hostConversationLanguage(q: Queryable, hostAccountId: string): Promise<ChannelLanguage> {
  const [latest] = await q<{ message: string }[]>`
    select i.message from app.conversation_inputs i
    join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'host_account' and d.principal_id = ${hostAccountId}
    order by i.accepted_at desc, i.id desc
    limit 1
  `;
  return textLanguage(latest?.message) ?? "en";
}

// The language a reply to `text` takes: the text's own when it is not a command,
// else the host's conversation.
export async function replyLanguage(q: Queryable, hostAccountId: string | null, text: string | null, isCommand: boolean): Promise<ChannelLanguage> {
  const own = isCommand ? null : textLanguage(text);
  if (own) return own;
  return hostAccountId ? hostConversationLanguage(q, hostAccountId) : (textLanguage(text) ?? "en");
}
