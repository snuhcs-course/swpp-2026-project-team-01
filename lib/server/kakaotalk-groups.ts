import { randomUUID } from "node:crypto";
import { getChatMessageLengthError } from "../contracts/chat-message";
import { admitConversationInput, AdmissionLimitError } from "./conversation-admission";
import {
  AGENT_VERSION,
  ConversationInputError,
  type ConversationDependencies,
  deliverNext,
  latestSession,
  type SessionRow,
  withPrincipalAuthority,
} from "./conversations";
import type { Queryable, Transaction } from "./database";
import { recordOutbound } from "./imessage-outbox";
import { signInternalBearer } from "./internal-bearer";
import { type Principal, sessionIdHash } from "./model-limits";
import { channelHash } from "./photon-receiver";
import { protectInput, sameProtectedInput } from "./redaction";
import type { SessionPrincipal } from "./setup-tools";
import { openToken, sealToken, type TokenKey } from "./token-encryption";

// KakaoTalk group chats (kakaotalk-group-conversations). The Mac relay
// forwards every member's text from every group the product's account is in.
// Each group is its own principal (kakaotalk_group) with one group_chat
// discussion, owned by no host, whose sessions get no tools (design 2).
//   - A message that does not call the assistant is kept, sealed, as context
//     for 24 hours, and runs no model (design 3).
//   - A message that calls it (starts with "@", or names the account or the
//     assistant, KAKAOTALK_GROUP_NAMES) becomes one input: the context since the
//     last call, then the calling message, each line with its sender's name. The
//     reply waits for that turn and goes to the group (design 4).
//   - At most KAKAOTALK_GROUP_DAILY_REPLIES calls a group and
//     KAKAOTALK_GROUPS_DAILY_REPLIES calls across groups are answered in 24
//     hours; beyond them a call is kept as context. Model costs are charged to
//     the group as anonymous work (design 5).

type Environment = Readonly<Record<string, string | undefined>>;

export const GROUP_NAMES = ["TimeRabbit", "타임래빗", "eve", "이브"];
export const GROUP_DAILY_REPLIES = 30;
export const GROUPS_DAILY_REPLIES = 300;
export const GROUP_CONTEXT_HOURS = 24;
export const GROUP_CONTEXT_MESSAGES = 30;
export const GROUP_PREFIX = "[KakaoTalk group]";

export type GroupSettings = {
  readonly names: readonly string[];
  readonly groupDailyReplies: number;
  readonly groupsDailyReplies: number;
};

function count(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return value?.trim() && Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function groupSettings(env: Environment = process.env): GroupSettings {
  const names = (env.KAKAOTALK_GROUP_NAMES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    groupDailyReplies: count(env.KAKAOTALK_GROUP_DAILY_REPLIES, GROUP_DAILY_REPLIES),
    groupsDailyReplies: count(env.KAKAOTALK_GROUPS_DAILY_REPLIES, GROUPS_DAILY_REPLIES),
    names: names.length > 0 ? names : GROUP_NAMES,
  };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether a message calls the assistant: it starts with "@", or names it. A
// Latin name counts only as a whole word ("eve", not "every" or "seven"); a
// Korean one anywhere, since Korean attaches particles ("이브야", "타임래빗한테").
export function callsAssistant(text: string, names: readonly string[] = GROUP_NAMES) {
  const trimmed = text.trim();
  if (trimmed.startsWith("@")) return true;
  return names.some((name) =>
    /^[\x20-\x7e]+$/.test(name) ? new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, "i").test(trimmed) : trimmed.includes(name),
  );
}

export const groupContext = (groupId: string) => `kakaotalk_group:${groupId}`;
export const groupMessageContext = (messageId: string) => `kakaotalk_group_message:${messageId}`;

// The group of a room, created on its first message and committed at once, so
// the conversation's own transaction sees it; null once the account left it.
export async function groupOfRoom(db: Queryable, tokenKey: TokenKey, roomId: string) {
  const roomHash = channelHash(tokenKey, "kakaotalk", "space", roomId);
  const fresh = randomUUID();
  await db`
    insert into app.kakaotalk_groups (id, room_hash, room_ciphertext, sealed_key_id)
    values (${fresh}, ${roomHash}, ${sealToken(tokenKey, roomId, groupContext(fresh)).ciphertext}, ${tokenKey.id})
    on conflict (room_hash) do nothing
  `;
  const [group] = await db<{ id: string; left_at: Date | null }[]>`select id, left_at from app.kakaotalk_groups where room_hash = ${roomHash}`;
  return group && !group.left_at ? { id: group.id, roomHash } : null;
}

// One context line: the sender's KakaoTalk name and the text.
export function contextLine(name: string | null, text: string) {
  return `${name?.trim() || "?"}: ${text.replace(/\s+/g, " ").trim()}`;
}

async function keepContext(tx: Transaction, tokenKey: TokenKey, groupId: string, receiptId: string, line: string, sentAt: Date | null) {
  const id = randomUUID();
  await tx`
    insert into app.kakaotalk_group_messages (id, group_id, receipt_id, text_ciphertext, sealed_key_id, sent_at)
    values (${id}, ${groupId}, ${receiptId}, ${sealToken(tokenKey, line, groupMessageContext(id)).ciphertext}, ${tokenKey.id},
            ${sentAt ?? new Date()})
    on conflict (receipt_id) do nothing
  `;
  // Only the newest messages of the last day are kept.
  await tx`
    delete from app.kakaotalk_group_messages
    where group_id = ${groupId}
      and (created_at < now() - make_interval(hours => ${GROUP_CONTEXT_HOURS})
           or id not in (select id from app.kakaotalk_group_messages where group_id = ${groupId}
                         order by created_at desc, id desc limit ${GROUP_CONTEXT_MESSAGES}))
  `;
}

// The kept context of a group, oldest first, removed as it is taken.
async function takeContext(tx: Transaction, keys: readonly TokenKey[], groupId: string) {
  const rows = await tx<{ id: string; text_ciphertext: string; sealed_key_id: string; created_at: Date }[]>`
    delete from app.kakaotalk_group_messages
    where group_id = ${groupId} and created_at >= now() - make_interval(hours => ${GROUP_CONTEXT_HOURS})
    returning id, text_ciphertext, sealed_key_id, created_at
  `;
  const lines: string[] = [];
  for (const row of [...rows].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : 1))) {
    try {
      lines.push(openToken(keys, { ciphertext: row.text_ciphertext, keyId: row.sealed_key_id }, groupMessageContext(row.id)));
    } catch {
      // A line that no longer opens is dropped.
    }
  }
  return lines;
}

// The model input of one call: the context, then the calling message.
export function groupInput(roomName: string | null, context: readonly string[], call: string) {
  const header = roomName ? `${GROUP_PREFIX} ${roomName}` : GROUP_PREFIX;
  const earlier = context.length > 0 ? `Earlier messages:\n${context.join("\n")}\n\n` : "";
  return `${header}\n${earlier}Message to you:\n${call}`;
}

// Calls answered in the last 24 hours: in this group, and in every group.
async function repliesToday(tx: Transaction, roomHash: string) {
  const [row] = await tx<{ group: number; all: number }[]>`
    select count(*) filter (where recipient_hash = ${roomHash})::int as group, count(*)::int as all
    from app.imessage_outbox
    where channel = 'kakaotalk' and kind = 'turn' and binding_id is null and requester_binding_id is null
      and created_at > now() - interval '24 hours'
  `;
  return row!;
}

async function lockGroupDiscussion(tx: Transaction, groupId: string) {
  await tx`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('kakaotalk_group', ${groupId}, 'group_chat')
    on conflict (principal_type, principal_id, audience, request_id) do nothing
  `;
  const [row] = await tx<{ id: string }[]>`
    select id from app.discussions
    where principal_type = 'kakaotalk_group' and principal_id = ${groupId} and audience = 'group_chat'
    for update
  `;
  if (!row) throw new ConversationInputError("invalid_message", "This conversation is not available.");
  return row.id;
}

async function createGroupSession(deps: ConversationDependencies, principal: Principal, discussionId: string, generation: number): Promise<SessionRow> {
  let sessionId: string;
  try {
    sessionId = await deps.runtime.createSession(signInternalBearer({ discussionId, generation, kind: "create", principal }, deps.signingKey));
  } catch (error) {
    const latest = await latestSession(deps.db, discussionId);
    if (latest && latest.generation >= generation) return latest;
    throw error;
  }
  return withPrincipalAuthority(deps.db, principal, async (tx) => {
    await lockGroupDiscussion(tx, principal.id);
    const latest = await latestSession(tx, discussionId);
    if (latest && latest.generation >= generation) return latest;
    const [row] = await tx<SessionRow[]>`
      insert into app.agent_sessions
        (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussionId}, ${principal.type}, ${principal.id}, ${generation}, ${AGENT_VERSION})
      returning session_id, discussion_id, principal_type, principal_id, generation, state, current_input_id, last_stream_index
    `;
    return row!;
  });
}

// Records the call as the group discussion's input (keyed by the receipt, so a
// retried job finds it) and delivers it; the input's ID.
export async function acceptGroupMessage(deps: ConversationDependencies, groupId: string, input: { readonly clientInputId: string; readonly message: string }) {
  const principal: Principal = { id: groupId, type: "kakaotalk_group" };
  const recorded = await withPrincipalAuthority(deps.db, principal, async (tx) => {
    const discussionId = await lockGroupDiscussion(tx, groupId);
    const [existing] = await tx<{ id: string; fingerprint: string; message: string; protected_fingerprint: string | null; state: string }[]>`
      select id, fingerprint, protected_fingerprint, message, state from app.conversation_inputs
      where discussion_id = ${discussionId} and client_input_id = ${input.clientInputId}
    `;
    if (existing) {
      if (!sameProtectedInput(existing, deps.signingKey, input.message)) {
        throw new ConversationInputError("retry_conflict", "This message conflicts with an earlier one.");
      }
      return { discussionId, inputId: existing.id, state: existing.state };
    }
    await admitConversationInput(tx, { key: groupId, scope: "group" }, deps.admission);
    const protectedInput = protectInput(deps.signingKey, input.message, { bareUuids: true });
    const [created] = await tx<{ id: string }[]>`
      insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, protected_fingerprint, message)
      values (${discussionId}, ${input.clientInputId}, ${protectedInput.fingerprint}, ${protectedInput.protectedFingerprint}, ${protectedInput.message})
      returning id
    `;
    return { discussionId, inputId: created!.id, state: "accepted" };
  });
  if (recorded.state === "accepted") {
    try {
      const session = (await latestSession(deps.db, recorded.discussionId)) ?? (await createGroupSession(deps, principal, recorded.discussionId, 1));
      if (session.state === "active") await deliverNext(deps, principal, recorded.discussionId);
    } catch (error) {
      // A runtime refusal leaves the input accepted; the next call or recovery delivers it.
      if (!(error instanceof ConversationInputError && error.code === "runtime_unavailable")) throw error;
    }
  }
  return recorded.inputId;
}

export type GroupMessage = {
  readonly receiptId: string;
  readonly roomId: string;
  readonly roomName: string | null;
  readonly senderName: string | null;
  readonly text: string;
  readonly sentAt: Date | null;
};

export type GroupDependencies = {
  readonly conversation: ConversationDependencies;
  readonly tokenKey: TokenKey;
  readonly tokenKeys: readonly TokenKey[];
  readonly settings?: GroupSettings;
};

export class GroupAdmissionDeferred extends Error {
  constructor() {
    super("The group's input admission is limited for now.");
    this.name = "GroupAdmissionDeferred";
  }
}

// One member message of a group: kept as context, or a call that is answered.
// "ignored" for context and for a group the account left; "forwarded" for a
// call whose reply now waits for its turn.
export async function receiveGroupMessage(tx: Transaction, deps: GroupDependencies, message: GroupMessage): Promise<"ignored" | "forwarded"> {
  const settings = deps.settings ?? groupSettings();
  const group = await groupOfRoom(deps.conversation.db, deps.tokenKey, message.roomId);
  if (!group) return "ignored";
  const line = contextLine(message.senderName, message.text);

  const replies = await repliesToday(tx, group.roomHash);
  const answer = callsAssistant(message.text, settings.names) && replies.group < settings.groupDailyReplies && replies.all < settings.groupsDailyReplies;
  if (!answer) {
    await keepContext(tx, deps.tokenKey, group.id, message.receiptId, line, message.sentAt);
    return "ignored";
  }

  // A retry of this receipt finds the input it recorded and sends no context again.
  const [earlier] = await tx<{ id: string }[]>`
    select i.id from app.conversation_inputs i join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'kakaotalk_group' and d.principal_id = ${group.id} and i.client_input_id = ${message.receiptId}
  `;
  let inputId = earlier?.id ?? null;
  if (!inputId) {
    const context = await takeContext(tx, deps.tokenKeys, group.id);
    let text = groupInput(message.roomName, context, line);
    // The oldest context goes first when the input would be too long.
    while (getChatMessageLengthError(text) && context.length > 0) {
      context.shift();
      text = groupInput(message.roomName, context, line);
    }
    if (getChatMessageLengthError(text)) return "ignored";
    try {
      inputId = await acceptGroupMessage(deps.conversation, group.id, { clientInputId: message.receiptId, message: text });
    } catch (error) {
      if (error instanceof AdmissionLimitError) throw new GroupAdmissionDeferred();
      if (error instanceof ConversationInputError) return "ignored";
      throw error;
    }
  }

  await recordOutbound(tx, {
    channel: "kakaotalk",
    dedupeKey: `input:${inputId}`,
    inputId,
    kind: "turn",
    recipient: { address: message.roomId, spaceId: message.roomId },
    recipientHash: group.roomHash,
    tokenKey: deps.tokenKey,
  });
  return "forwarded";
}

// Marks a group left, so nothing more is recorded or answered there, and drops its context.
export async function markGroupLeft(db: Queryable, tokenKey: TokenKey, roomId: string) {
  const roomHash = channelHash(tokenKey, "kakaotalk", "space", roomId);
  const [row] = await db<{ id: string }[]>`
    update app.kakaotalk_groups set left_at = coalesce(left_at, now()) where room_hash = ${roomHash} returning id
  `;
  if (row) await db`delete from app.kakaotalk_group_messages where group_id = ${row.id}`;
  return Boolean(row);
}

// Whether an eve session is a KakaoTalk group chat's (design 2); such a session
// gets the group instructions and no tools.
export function isGroupChatSession(principal: SessionPrincipal | null | undefined) {
  return principal?.principalType === "user" && principal.attributes.audience === "group_chat" && principal.principalId.startsWith("group:");
}
