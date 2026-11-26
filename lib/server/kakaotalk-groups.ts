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

// The product account's KakaoTalk name, in English and Korean.
export const GROUP_NAMES = ["TimeRabbit", "타임래빗"];
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

// Particles that may follow a Korean name when it is called ("타임래빗아",
// "타임래빗한테"); a Korean name followed by anything else, or preceded by a
// Hangul syllable, is part of another word.
const PARTICLES = ["", "야", "아", "님", "씨", "한테", "에게", "께", "랑", "이랑", "는", "은", "가", "이", "도", "요"];
const HANGUL = /[\uac00-\ud7a3]/;

function namesKorean(text: string, name: string) {
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    if (at > 0 && HANGUL.test(text[at - 1]!)) continue;
    const rest = text.slice(at + name.length);
    const particle = PARTICLES.find((candidate) => rest.startsWith(candidate) && !HANGUL.test(rest[candidate.length] ?? ""));
    if (particle !== undefined) return true;
  }
  return false;
}

function namesLatin(text: string, name: string) {
  return new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, "i").test(text);
}

// Whether a message calls the assistant: it names the account or the assistant,
// with or without "@" in front. A Latin name counts only as a whole word, and
// an "@" before someone else's name ("@김철수") calls no one.
export function callsAssistant(text: string, names: readonly string[] = GROUP_NAMES) {
  const trimmed = text.trim();
  return names.some((name) => (/^[\x20-\x7e]+$/.test(name) ? namesLatin(trimmed, name) : namesKorean(trimmed, name)));
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
  // Only the newest messages of this group are kept; app.sweep_kakaotalk_group_messages
  // removes every group's lines past 24 hours each hour.
  await tx`
    delete from app.kakaotalk_group_messages
    where group_id = ${groupId}
      and (created_at < now() - make_interval(hours => ${GROUP_CONTEXT_HOURS})
           or id not in (select id from app.kakaotalk_group_messages where group_id = ${groupId}
                         order by created_at desc, id desc limit ${GROUP_CONTEXT_MESSAGES}))
  `;
}

// The kept context of a group, oldest first, with the IDs of its rows. It is
// not removed here: the call's input removes exactly these rows in the
// transaction that records it, so a deferred or failed call loses nothing and a
// recorded one never sends them twice.
async function readContext(tx: Transaction, keys: readonly TokenKey[], groupId: string) {
  const rows = await tx<{ id: string; text_ciphertext: string; sealed_key_id: string }[]>`
    select id, text_ciphertext, sealed_key_id from app.kakaotalk_group_messages
    where group_id = ${groupId} and created_at >= now() - make_interval(hours => ${GROUP_CONTEXT_HOURS})
    order by created_at, id
  `;
  const lines: { readonly id: string; readonly line: string }[] = [];
  for (const row of rows) {
    try {
      lines.push({ id: row.id, line: openToken(keys, { ciphertext: row.text_ciphertext, keyId: row.sealed_key_id }, groupMessageContext(row.id)) });
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

// A group reply's dedupe key: the one marker that tells a group's reply from a
// host's or guest's (the claim, the counter and the reply's cut use it).
export const GROUP_REPLY_PREFIX = "group-input:";

// Calls answered in the last 24 hours: in this group, and in every group. The
// count is taken under one lock, held until the reply row is recorded, so
// parallel receipts of different groups never pass the total together.
async function repliesToday(tx: Transaction, roomHash: string) {
  await tx`select pg_advisory_xact_lock(hashtextextended('app.kakaotalk_group_replies', 0))`;
  const [row] = await tx<{ group: number; all: number }[]>`
    select count(*) filter (where recipient_hash = ${roomHash})::int as group, count(*)::int as all
    from app.imessage_outbox
    where channel = 'kakaotalk' and kind = 'turn' and dedupe_key like ${`${GROUP_REPLY_PREFIX}%`}
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
// retried job finds it), removes the context rows it carries in the same
// transaction, and delivers it; the input's ID.
export async function acceptGroupMessage(
  deps: ConversationDependencies,
  groupId: string,
  input: { readonly clientInputId: string; readonly message: string; readonly contextIds?: readonly string[] },
) {
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
    if (input.contextIds?.length) {
      await tx`delete from app.kakaotalk_group_messages where group_id = ${groupId} and id = any(${input.contextIds}::uuid[])`;
    }
    return { discussionId, inputId: created!.id, state: "accepted" };
  });
  if (recorded.state === "accepted") {
    try {
      // A group has no recovery page: a failed generation is replaced by the next
      // one here, and its unfinished input goes on in it, so one failure never
      // silences the group.
      let session = (await latestSession(deps.db, recorded.discussionId)) ?? (await createGroupSession(deps, principal, recorded.discussionId, 1));
      if (session.state === "failed") {
        session = await createGroupSession(deps, principal, recorded.discussionId, session.generation + 1);
        await deps.db`
          update app.conversation_inputs set state = 'accepted', session_id = null, sent_at = null, received_session_id = null
          where discussion_id = ${recorded.discussionId} and state <> 'completed'
        `;
      }
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

  // A retry of this receipt finds the input it recorded: its reply is recorded
  // whatever the limits say now, and no context goes again.
  const [earlier] = await tx<{ id: string }[]>`
    select i.id from app.conversation_inputs i join app.discussions d on d.id = i.discussion_id
    where d.principal_type = 'kakaotalk_group' and d.principal_id = ${group.id} and i.client_input_id = ${message.receiptId}
  `;
  let inputId = earlier?.id ?? null;

  if (!inputId) {
    // An untitled group cannot be answered (its chat-list label lists members),
    // so its calls stay context rather than running a model for nothing.
    const replies = await repliesToday(tx, group.roomHash);
    const answer =
      Boolean(message.roomName?.trim()) &&
      callsAssistant(message.text, settings.names) &&
      replies.group < settings.groupDailyReplies &&
      replies.all < settings.groupsDailyReplies;
    if (!answer) {
      await keepContext(tx, deps.tokenKey, group.id, message.receiptId, line, message.sentAt);
      return "ignored";
    }

    const context = await readContext(tx, deps.tokenKeys, group.id);
    let text = groupInput(message.roomName, context.map((entry) => entry.line), line);
    // The oldest context goes first when the input would be too long; what is
    // left out is removed with the rest.
    let sent = context.length;
    while (getChatMessageLengthError(text) && sent > 0) {
      sent -= 1;
      text = groupInput(message.roomName, context.slice(context.length - sent).map((entry) => entry.line), line);
    }
    if (getChatMessageLengthError(text)) return "ignored";
    try {
      inputId = await acceptGroupMessage(deps.conversation, group.id, {
        clientInputId: message.receiptId,
        contextIds: context.map((entry) => entry.id),
        message: text,
      });
    } catch (error) {
      if (error instanceof AdmissionLimitError) throw new GroupAdmissionDeferred();
      if (error instanceof ConversationInputError) return "ignored";
      throw error;
    }
  }

  await recordOutbound(tx, {
    channel: "kakaotalk",
    dedupeKey: `${GROUP_REPLY_PREFIX}${inputId}`,
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
