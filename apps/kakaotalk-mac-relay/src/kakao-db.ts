import { decodeIntegerArray } from "./bplist.ts";

// The KakaoTalk for Mac database, read through `kakaocli query`
// (host-kakaotalk-mac-relay design 3). kakaocli returns each row as a JSON
// array, with NULL as "". Every ID is selected as text, because log IDs have
// 19 digits and a JavaScript number keeps 15 or 16. IDs that go back into SQL
// are checked to be decimal first, so nothing else is ever spliced in.

export interface QueryRunner {
  query(sql: string): Promise<unknown[][]>;
}

export type RoomKind = "direct" | "group" | "other";

export type Room = {
  readonly chatId: string;
  readonly kind: RoomKind;
  // The room's own name (groups), and the other member's names (1:1 chats).
  readonly chatName: string;
  readonly memberNames: readonly string[];
  readonly directMemberUserId: string;
  readonly memberUserIds: readonly string[];
  readonly activeMembersCount: number;
  readonly lastLogId: string;
  // Whether the other member of a 1:1 chat has written in it (design 6).
  readonly memberWrote: boolean;
};

export type DbMessage = {
  readonly logId: string;
  readonly chatId: string;
  readonly authorId: string;
  // NTChatMessage.type: 1 is text, 0 a feed (such as an invitation), others attachments.
  readonly type: number;
  readonly text: string;
  // Seconds since the epoch, sometimes with a fraction.
  readonly sentAt: number;
};

const DECIMAL = /^-?\d{1,20}$/;

function decimal(value: string) {
  if (!DECIMAL.test(value)) throw new Error(`Not a decimal ID: ${JSON.stringify(value)}`);
  return value;
}

// The room types seen on 2026-11-26 (design 2): type 0 with no open link is a
// 1:1 chat, type 1 a group, and any room with an open link an open chat, which
// the relay treats as a group. Anything else (type 2 is 카카오계정) is ignored.
export function roomKind(type: number, linkId: string): RoomKind {
  if (linkId !== "0") return "group";
  if (type === 0) return "direct";
  if (type === 1) return "group";
  return "other";
}

// A group's title is not in NTChatRoom.chatName (empty on 2026-11-26) but in
// NTChatMeta with type 3, whose content is the title text.
export const ROOMS_SQL = `SELECT CAST(r.chatId AS TEXT), CAST(r.linkId AS TEXT), r.type, COALESCE(NULLIF(r.chatName, ''), t.content, ''),
  COALESCE(u.displayName, ''), COALESCE(u.friendNickName, ''), COALESCE(u.nickName, ''),
  CAST(r.directChatMemberUserId AS TEXT), COALESCE(hex(r.displayMemberIds), ''), r.activeMembersCount, CAST(r.lastLogId AS TEXT),
  EXISTS (SELECT 1 FROM NTChatMessage m WHERE m.chatId = r.chatId AND r.directChatMemberUserId <> 0 AND m.authorId = r.directChatMemberUserId)
FROM NTChatRoom r
LEFT JOIN NTUser u ON u.userId = r.directChatMemberUserId AND u.linkId = 0
LEFT JOIN NTChatMeta t ON t.chatId = r.chatId AND t.type = 3
ORDER BY r.chatId`;

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const number = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : 0);

export const USERS_SQL = `SELECT CAST(userId AS TEXT), COALESCE(displayName, ''), COALESCE(friendNickName, ''), COALESCE(nickName, '') FROM NTUser WHERE linkId = 0`;

// The names of each user, for an untitled group's label (its members' names).
export function parseUsers(rows: readonly unknown[][]) {
  return new Map(rows.map(([userId, ...names]) => [text(userId), [...new Set(names.map(text).filter((name) => name !== ""))]]));
}

// An untitled group's memberNames are its members' names, which its chat-list
// label is made of, so the name rule sees them too (design 5). A titled group
// is listed under its title alone.
export function parseRooms(rows: readonly unknown[][], users: ReadonlyMap<string, readonly string[]> = new Map()): Room[] {
  return rows.map((row) => {
    const [chatId, linkId, type, chatName, displayName, friendNickName, nickName, directMember, membersHex, activeMembers, lastLogId, wrote] = row;
    const kind = roomKind(number(type), text(linkId) || "0");
    const memberUserIds = decodeIntegerArray(text(membersHex)) ?? [];
    const names =
      kind === "group"
        ? // A titled group is listed under its title; only an untitled one under its members' names.
          text(chatName)
          ? []
          : memberUserIds.flatMap((userId) => users.get(userId) ?? [])
        : [text(displayName), text(friendNickName), text(nickName)].filter((name) => name !== "");
    return {
      activeMembersCount: number(activeMembers),
      chatId: decimal(text(chatId)),
      chatName: text(chatName),
      directMemberUserId: text(directMember) || "0",
      kind,
      lastLogId: text(lastLogId) || "0",
      memberNames: [...new Set(names)],
      memberUserIds,
      memberWrote: number(wrote) === 1,
    };
  });
}

export const MY_USER_ID_SQL = "SELECT CAST(userId AS TEXT) FROM NTChatContext LIMIT 1";

const MESSAGE_COLUMNS = `CAST(m.logId AS TEXT), CAST(m.chatId AS TEXT), CAST(m.authorId AS TEXT), m.type, COALESCE(m.message, ''), m.sentAt`;

// The messages of one room after a log ID, oldest first.
export function roomMessagesSql(chatId: string, afterLogId: string, limit = 100) {
  return `SELECT ${MESSAGE_COLUMNS} FROM NTChatMessage m
WHERE m.chatId = ${decimal(chatId)} AND m.logId > ${decimal(afterLogId)}
ORDER BY m.logId LIMIT ${Math.trunc(limit)}`;
}

// The messages of a room the relay had not seen, posted since it first started.
export function newRoomMessagesSql(chatId: string, sinceSeconds: number, limit = 100) {
  return `SELECT ${MESSAGE_COLUMNS} FROM NTChatMessage m
WHERE m.chatId = ${decimal(chatId)} AND m.sentAt >= ${Math.floor(sinceSeconds)}
ORDER BY m.logId LIMIT ${Math.trunc(limit)}`;
}

// The account's own messages after a log ID in any room, for the landing check (design 5).
export function ownMessagesSql(myUserId: string, afterLogId: string) {
  return `SELECT ${MESSAGE_COLUMNS} FROM NTChatMessage m
WHERE m.authorId = ${decimal(myUserId)} AND m.logId > ${decimal(afterLogId)}
ORDER BY m.logId LIMIT 50`;
}

export const MAX_LOG_ID_SQL = "SELECT CAST(COALESCE(MAX(logId), 0) AS TEXT) FROM NTChatMessage";

export function parseMessages(rows: readonly unknown[][]): DbMessage[] {
  return rows.map(([logId, chatId, authorId, type, message, sentAt]) => ({
    authorId: text(authorId),
    chatId: decimal(text(chatId)),
    logId: decimal(text(logId)),
    sentAt: number(sentAt),
    text: text(message),
    type: number(type),
  }));
}

// Log IDs compared as the integers they are.
export function logIdAfter(a: string, b: string) {
  return BigInt(a) > BigInt(b);
}

// What the relay reads; KakaoDatabase reads it through kakaocli, and the tests'
// FakeKakao (testing.ts) from recorded rows.
export type KakaoReader = {
  rooms(): Promise<Room[]>;
  // Each user's names (NTUser, linkId 0), for group members.
  users(): Promise<ReadonlyMap<string, readonly string[]>>;
  myUserId(): Promise<string>;
  maxLogId(): Promise<string>;
  messagesAfter(chatId: string, afterLogId: string): Promise<DbMessage[]>;
  messagesSince(chatId: string, sinceSeconds: number): Promise<DbMessage[]>;
  ownMessagesAfter(myUserId: string, afterLogId: string): Promise<DbMessage[]>;
};

export class KakaoDatabase implements KakaoReader {
  readonly #runner: QueryRunner;

  constructor(runner: QueryRunner) {
    this.#runner = runner;
  }

  async users() {
    return parseUsers(await this.#runner.query(USERS_SQL));
  }

  async rooms() {
    return parseRooms(await this.#runner.query(ROOMS_SQL), await this.users());
  }

  async myUserId() {
    const [row] = await this.#runner.query(MY_USER_ID_SQL);
    return decimal(text(row?.[0]));
  }

  async maxLogId() {
    const [row] = await this.#runner.query(MAX_LOG_ID_SQL);
    return decimal(text(row?.[0]) || "0");
  }

  async messagesAfter(chatId: string, afterLogId: string) {
    return parseMessages(await this.#runner.query(roomMessagesSql(chatId, afterLogId)));
  }

  async messagesSince(chatId: string, sinceSeconds: number) {
    return parseMessages(await this.#runner.query(newRoomMessagesSql(chatId, sinceSeconds)));
  }

  async ownMessagesAfter(myUserId: string, afterLogId: string) {
    return parseMessages(await this.#runner.query(ownMessagesSql(myUserId, afterLogId)));
  }
}
