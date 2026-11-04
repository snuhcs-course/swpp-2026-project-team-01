import { z } from "zod";
import { IMESSAGE_PREFIX, type MessagingChannel, WHATSAPP_PREFIX } from "../contracts/messaging-channel";
import type { Database } from "./database";
import { HOST_REVIEW_AUDIENCE, HOST_SETUP_AUDIENCE } from "./eve-auth";
import { listHostRequests } from "./host-requests";
import { requestRef } from "./request-ref";
import type { SessionPrincipal } from "./setup-tools";

// Switching the linked conversation in words (host-imessage-channel D25,
// issue #125). The binding's selected request decides where the host's free
// text goes: a request's private review, or setup when none is selected. The
// exact commands `request <ref>` and `setup` change it; this tool lets the
// assistant do the same when the host names a request ("박도현's request",
// "6ADSRV") or setup in words. It works only while the turn answers a message
// from the linked iMessage or WhatsApp, the session's current input with its
// channel prefix; on the web the host opens a request from the inbox.

export const switchConversationToolInput = z
  .object({
    to: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe('"setup", a request reference such as 6ADSRV, or the requester\'s name as the host wrote it.'),
  })
  .strict();

export type SwitchConversationCall = {
  readonly auth: SessionPrincipal;
  readonly sessionId: string;
};

type Switched =
  | { readonly switched: true; readonly to: "setup"; readonly message: string }
  | { readonly switched: true; readonly to: "request"; readonly ref: string; readonly requesterName: string; readonly message: string }
  | { readonly switched: false; readonly problem: string; readonly matches?: readonly { readonly ref: string; readonly requesterName: string; readonly purpose: string | null }[] };

const uuid = z.uuid();
const OPEN_STATES = new Set(["gathering", "negotiating", "awaiting_host_approval", "booking"]);

function channelOf(message: string): MessagingChannel | null {
  if (message.startsWith(IMESSAGE_PREFIX)) return "imessage";
  if (message.startsWith(WHATSAPP_PREFIX)) return "whatsapp";
  return null;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function switchConversationForTool(db: Database, call: SwitchConversationCall, input: z.infer<typeof switchConversationToolInput>): Promise<Switched> {
  const hostAccountId = uuid.safeParse(call.auth?.principalId);
  const audience = call.auth?.attributes?.audience;
  if (call.auth?.principalType !== "user" || !hostAccountId.success || (audience !== HOST_SETUP_AUDIENCE && audience !== HOST_REVIEW_AUDIENCE)) {
    return { problem: "This conversation cannot switch requests.", switched: false };
  }

  // The session must be the host's own, live one; its current input is the
  // message this turn answers.
  const [turn] = await db<{ message: string | null }[]>`
    select i.message from app.agent_sessions s
    left join app.conversation_inputs i on i.id = s.current_input_id
    where s.session_id = ${call.sessionId} and s.principal_type = 'host_account'
      and s.principal_id = ${hostAccountId.data} and s.state = 'active'
  `;
  if (!turn) return { problem: "This conversation cannot switch requests.", switched: false };

  const channel = turn.message ? channelOf(turn.message) : null;
  if (!channel) {
    return { problem: "Switching applies to the host's linked iMessage or WhatsApp. On the web, the host opens the request from the inbox.", switched: false };
  }

  const [binding] = await db<{ id: string }[]>`
    select id from app.imessage_bindings
    where host_account_id = ${hostAccountId.data} and state = 'active' and channel = ${channel}
  `;
  if (!binding) return { problem: "The conversation is no longer linked.", switched: false };

  const target = normalize(input.to);
  if (target === "setup" || target === "settings" || target === "설정") {
    await db`update app.imessage_bindings set selected_request_id = null where id = ${binding.id} and state = 'active'`;
    return { message: "From the host's next message, this conversation is about setup. Tell them so.", switched: true, to: "setup" };
  }

  const requests = await listHostRequests(db, hostAccountId.data);
  const byRef = requests.filter((item) => requestRef(item.requestId).toLowerCase() === target.replace(/^request\s+/, ""));
  const byName = byRef.length ? byRef : requests.filter((item) => normalize(item.requesterName).includes(target) || target.includes(normalize(item.requesterName)));
  // An open request wins over a closed one with the same name.
  const open = byName.filter((item) => OPEN_STATES.has(item.state));
  const matches = open.length ? open : byName;

  if (matches.length === 0) {
    return { problem: `No request matches "${input.to}". Call list_host_requests or ask the host which request they mean.`, switched: false };
  }
  if (matches.length > 1) {
    return {
      matches: matches.slice(0, 5).map((item) => ({ purpose: item.purpose, ref: requestRef(item.requestId), requesterName: item.requesterName })),
      problem: "More than one request matches. Ask the host which one, naming each by requester, purpose and reference.",
      switched: false,
    };
  }

  const [chosen] = matches;
  await db`update app.imessage_bindings set selected_request_id = ${chosen!.requestId} where id = ${binding.id} and state = 'active'`;
  return {
    message: `From the host's next message, this conversation is about request ${requestRef(chosen!.requestId)} with ${chosen!.requesterName}. Tell them so; the current reply still comes from this discussion.`,
    ref: requestRef(chosen!.requestId),
    requesterName: chosen!.requesterName,
    switched: true,
    to: "request",
  };
}
