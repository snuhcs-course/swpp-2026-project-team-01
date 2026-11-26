import type { HostRequestItem } from "../contracts/host-request";
import { IMESSAGE_PREFIX, type MessagingChannel, TELEGRAM_PREFIX, WHATSAPP_PREFIX } from "../contracts/messaging-channel";
import type { Queryable } from "./database";
import { requestRef } from "./request-ref";

const OPEN_STATES = new Set(["gathering", "negotiating", "awaiting_host_approval", "booking"]);

export function channelOf(message: string): MessagingChannel | null {
  if (message.startsWith(IMESSAGE_PREFIX)) return "imessage";
  if (message.startsWith(WHATSAPP_PREFIX)) return "whatsapp";
  if (message.startsWith(TELEGRAM_PREFIX)) return "telegram";
  return null;
}

// The channel of the message the host's session is answering: its current
// input, which the receipt job recorded with the receipt's ID as its client
// input ID and the channel's prefix. Null for a message typed on the web, even
// one that starts with a prefix, or when the session is not the host's own live
// one. Every action the assistant takes in the host's words checks this first
// (channel-actions-in-words D1).
export async function channelOfTurn(db: Queryable, sessionId: string, hostAccountId: string): Promise<MessagingChannel | null> {
  return (await linkedMessagingTurn(db, sessionId, hostAccountId))?.channel ?? null;
}

export async function linkedMessagingTurn(db: Queryable, sessionId: string, hostAccountId: string) {
  const [turn] = await db<{ inputId: string; message: string; channel: MessagingChannel }[]>`
    select i.id as "inputId", i.message, r.channel from app.agent_sessions s
    join app.conversation_inputs i on i.id = s.current_input_id
    join app.imessage_receipts r on r.id = i.client_input_id
    join app.imessage_bindings b on b.host_account_id = s.principal_id
      and b.sender_hash = r.sender_hash and b.channel = r.channel and b.state = 'active'
    where s.session_id = ${sessionId} and s.principal_type = 'host_account'
      and s.principal_id = ${hostAccountId} and s.state = 'active'
  `;
  return turn && channelOf(turn.message) === turn.channel ? turn : null;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// A name as the host wrote it, without a possessive ("Eunwoo Lee's",
// "이은우님 거", "이은우씨 요청").
function bareName(value: string) {
  return normalize(value)
    .replace(/(?:'s|’s|'|’)?(?:\s*(?:request|one|meeting))?$/u, "")
    .replace(/\s*(?:님|씨)?\s*(?:의)?\s*(?:거|것|건|요청|미팅)?$/u, "")
    .trim();
}

// The host's requests a reference names, as the host wrote it: a request
// reference such as 6ADSRV (with or without "request "), or else the
// requester's name. To switch, either name may contain the other; a decision
// (issue #382), which cannot be undone, takes only the exact name, so "Lee"
// never decides Eunwoo Lee's request. An open request wins over a closed one.
export function matchHostRequests(requests: readonly HostRequestItem[], reference: string, options: { readonly exactName?: boolean } = {}): HostRequestItem[] {
  const target = normalize(reference);
  const byRef = requests.filter((item) => requestRef(item.requestId).toLowerCase() === target.replace(/^request\s+/, ""));
  const bare = bareName(reference);
  const byName = byRef.length
    ? byRef
    : requests.filter((item) =>
        options.exactName
          ? bare.length > 0 && normalize(item.requesterName) === bare
          : normalize(item.requesterName).includes(target) || target.includes(normalize(item.requesterName)),
      );
  const open = byName.filter((item) => OPEN_STATES.has(item.state));
  return open.length ? open : byName;
}
