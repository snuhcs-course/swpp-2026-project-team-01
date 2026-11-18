import { createHash, randomUUID } from "node:crypto";
import type { ToolStub } from "eve/evals";
import { EVAL_REQUEST_HEADER } from "../../lib/server/eve-auth";
import { sessionIdHash } from "../../lib/server/model-limits";
import { storyRuntime } from "./runtime";

// Eval sessions over seeded requests, indexed the way the message routes index
// them so the model limit middleware attributes every call. A host message from
// a linked messenger reaches the assistant with its channel prefix and is
// recorded as the routes record it: a processed receipt and the accepted input
// the session's current_input_id names, which is what the host decision tools
// check before they act (channel-selection.ts, channelOfTurn).

export type HostChannel = "telegram" | "imessage" | "whatsapp";
export type GuestChannel = "web" | "imessage" | "email";

export const HOST_PREFIX: Readonly<Record<HostChannel, string>> = { imessage: "[iMessage] ", telegram: "[Telegram] ", whatsapp: "[WhatsApp] " };
export const GUEST_PREFIX: Readonly<Record<GuestChannel, string>> = { email: "[Email] ", imessage: "[iMessage] ", web: "" };

type EvalSession = { readonly sessionId: string; send(message: string): Promise<EvalTurn> };
export type EvalTurn = {
  readonly message: string | null | undefined;
  readonly toolCalls: readonly { readonly name: string; readonly input?: unknown; readonly output?: unknown; readonly status?: string }[];
};
export type EvalContext = { session(options: { headers: Record<string, string>; stubs: ToolStub[] }): Promise<EvalSession> };

const hex = (value: string) => createHash("sha256").update(value).digest("hex");

async function indexSession(sessionId: string, discussionId: string, principalType: "host_account" | "requester_request", principalId: string) {
  const { db } = storyRuntime();
  await db`
    insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
    values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussionId}, ${principalType}, ${principalId}, 1, 'eval')
  `;
}

export async function guestSession(t: EvalContext, requestId: string, channel: GuestChannel, stubs: ToolStub[] = []) {
  const { db } = storyRuntime();
  const [discussion] = await db<{ id: string }[]>`
    select id from app.discussions where principal_type = 'requester_request' and principal_id = ${requestId} and audience = 'requester'
  `;
  const session = await t.session({ headers: { [EVAL_REQUEST_HEADER]: requestId }, stubs });
  await indexSession(session.sessionId, discussion!.id, "requester_request", requestId);
  return {
    sessionId: session.sessionId,
    async send(text: string) {
      await db`update app.agent_sessions set current_input_id = ${randomUUID()} where session_id = ${session.sessionId}`;
      return session.send(`${GUEST_PREFIX[channel]}${text}`);
    },
  };
}

// The host's linked conversation on a channel, selecting a request.
export async function linkHost(hostAccountId: string, channel: HostChannel, selectedRequestId: string | null) {
  const { db } = storyRuntime();
  await db`
    insert into app.imessage_bindings (host_account_id, channel, sender_hash, sender_ciphertext, sealed_key_id, selected_request_id)
    values (${hostAccountId}, ${channel}, ${hex(`eval-sender-${randomUUID()}`)}, 'eval-sealed', 'eval', ${selectedRequestId})
  `;
}

export async function selectedRequestOf(hostAccountId: string) {
  const { db } = storyRuntime();
  const [row] = await db<{ selected_request_id: string | null }[]>`
    select selected_request_id from app.imessage_bindings where host_account_id = ${hostAccountId} and state = 'active'
  `;
  return row?.selected_request_id ?? null;
}

async function hostReviewDiscussion(hostAccountId: string, requestId: string) {
  const { db } = storyRuntime();
  await db`
    insert into app.discussions (principal_type, principal_id, audience, request_id)
    values ('host_account', ${hostAccountId}, 'host_review', ${requestId})
    on conflict do nothing
  `;
  const [row] = await db<{ id: string }[]>`
    select id from app.discussions where principal_type = 'host_account' and principal_id = ${hostAccountId}
      and audience = 'host_review' and request_id = ${requestId}
  `;
  return row!.id;
}

// The host's private review of one request. `channel` null is the web chat.
export async function hostReviewSession(t: EvalContext, hostAccountId: string, requestId: string, channel: HostChannel | null, stubs: ToolStub[] = []) {
  const { db } = storyRuntime();
  const discussionId = await hostReviewDiscussion(hostAccountId, requestId);
  const session = await t.session({ headers: { [EVAL_REQUEST_HEADER]: requestId }, stubs });
  await indexSession(session.sessionId, discussionId, "host_account", hostAccountId);
  return {
    requestId,
    sessionId: session.sessionId,
    async send(text: string) {
      const message = channel ? `${HOST_PREFIX[channel]}${text}` : text;
      const clientInputId = randomUUID();
      if (channel) {
        await db`
          insert into app.imessage_receipts
            (id, channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256, outcome, processed_at)
          values (${clientInputId}, ${channel}, ${`eval-${clientInputId}`}, 'eval', ${hex(`s-${clientInputId}`)}, ${hex(`p-${clientInputId}`)},
                  'dm', 'text', ${hex(message)}, 'forwarded', now())
        `;
      }
      const [input] = await db<{ id: string }[]>`
        insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message, state, session_id)
        values (${discussionId}, ${clientInputId}, ${hex(message)}, ${message}, 'sent', ${session.sessionId})
        returning id
      `;
      await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${session.sessionId}`;
      return session.send(message);
    },
  };
}
