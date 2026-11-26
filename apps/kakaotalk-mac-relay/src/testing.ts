import { readFileSync } from "node:fs";
import type { LeaveAttempt, Messenger, Probe, SendAttempt, Ui } from "./delivery.ts";
import { type DbMessage, type KakaoReader, logIdAfter, parseMessages, parseRooms, type Room } from "./kakao-db.ts";
import { chatListName } from "./rooms.ts";

// Test doubles for the Mac relay, shared by its unit tests and the integration
// test (tests/integration/kakaotalk-mac-relay.test.ts). FakeKakao starts from the
// rows recorded on the Mac mini on 2026-11-26 (fixtures/db, IDs and names
// replaced): the 1:1 chat with "Test Host" (486083133936417, the phone's room ID
// too), the group "테스트 그룹" and 카카오계정. The account is 900000001.

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as unknown;

export const RECORDED = {
  account: "900000001",
  group: "100000000000002",
  host: "900000002",
  hostRoom: "486083133936417",
  kakaoAccount: "100000000000003",
  messages: () => fixture("db/messages.json") as unknown[][],
  rooms: () => fixture("db/rooms.json") as unknown[][],
  rows: () => fixture("ax/rows.json") as { names: string[] },
};

export class FakeKakao implements KakaoReader {
  rooms_: Room[];
  messages_: DbMessage[];
  readonly account: string;
  // Log IDs grow with time, so two fakes in one run never reuse one.
  #nextLog = 3990000000000000000n + BigInt(Date.now()) * 10_000n + BigInt(Math.floor(Math.random() * 1000)) * 1_000n;

  constructor(rooms: Room[] = parseRooms(RECORDED.rooms()), messages: DbMessage[] = parseMessages(RECORDED.messages()), account = RECORDED.account) {
    this.rooms_ = rooms;
    this.messages_ = messages;
    this.account = account;
  }

  // Adds a message as KakaoTalk would: a new log ID, and the room's last log ID moves.
  add(chatId: string, authorId: string, text: string, type = 1, sentAt = Date.now() / 1000) {
    this.#nextLog += 1000n;
    const message = { authorId, chatId, logId: this.#nextLog.toString(), sentAt, text, type };
    this.messages_.push(message);
    this.rooms_ = this.rooms_.map((room) =>
      room.chatId === chatId
        ? { ...room, lastLogId: message.logId, memberWrote: room.memberWrote || (room.kind === "direct" && authorId === room.directMemberUserId) }
        : room,
    );
    return message;
  }

  addRoom(room: Partial<Room> & Pick<Room, "chatId">) {
    const full: Room = {
      activeMembersCount: 2,
      chatName: "",
      directMemberUserId: "0",
      kind: "direct",
      lastLogId: "0",
      memberNames: [],
      memberUserIds: [],
      memberWrote: false,
      ...room,
    };
    this.rooms_.push(full);
    return full;
  }

  removeRoom(chatId: string) {
    this.rooms_ = this.rooms_.filter((room) => room.chatId !== chatId);
  }

  async rooms() {
    return this.rooms_.map((room) => ({ ...room }));
  }

  // Each user's names: the recorded 1:1 friend, the recorded group's members, and any set here.
  users_ = new Map<string, string[]>([
    [RECORDED.host, ["Test Host"]],
    ["900000003", ["Member Three"]],
    ["900000004", ["Member Four"]],
    ["900000005", ["Member Five"]],
  ]);

  async users() {
    return new Map(this.users_);
  }

  async myUserId() {
    return this.account;
  }

  async maxLogId() {
    return this.messages_.reduce((max, message) => (logIdAfter(message.logId, max) ? message.logId : max), "0");
  }

  async messagesAfter(chatId: string, afterLogId: string) {
    return this.#sorted(this.messages_.filter((message) => message.chatId === chatId && logIdAfter(message.logId, afterLogId)));
  }

  async messagesSince(chatId: string, sinceSeconds: number) {
    return this.#sorted(this.messages_.filter((message) => message.chatId === chatId && message.sentAt >= Math.floor(sinceSeconds)));
  }

  // Makes the landing check's read fail, as a kakaocli query timeout would.
  failOwnReads = false;

  async ownMessagesAfter(myUserId: string, afterLogId: string) {
    if (this.failOwnReads) throw new Error("kakaocli query failed (timeout)");
    return this.#sorted(this.messages_.filter((message) => message.authorId === myUserId && logIdAfter(message.logId, afterLogId)));
  }

  #sorted(messages: DbMessage[]) {
    return [...messages].sort((a, b) => (BigInt(a.logId) < BigInt(b.logId) ? -1 : 1)).slice(0, 100);
  }
}

// The chat list and probe as the helper reports them; labels default to the rooms' names.
export class FakeUi implements Ui {
  labels: string[] | null;
  probed: Probe = { kakaoRunning: true, kakaoVersion: "26.10.0", locked: false, trusted: true };
  leaveStage: LeaveAttempt["stage"] = "pressed";
  // Leaves this room instead of the one named, as a stray window would.
  leaveInstead: string | null = null;
  // The helper could not read the chat list (a locked screen, a hidden window).
  unavailable = false;
  readonly left: string[] = [];
  readonly #kakao: FakeKakao;

  constructor(kakao: FakeKakao, labels: string[] | null = null) {
    this.#kakao = kakao;
    this.labels = labels;
  }

  async probe() {
    return this.probed;
  }

  async chatListNames() {
    if (this.unavailable) return null;
    return this.labels ?? this.#kakao.rooms_.map(chatListName).filter((name) => name !== "");
  }

  async leave(name: string): Promise<LeaveAttempt> {
    this.left.push(name);
    if (this.leaveStage === "pressed") {
      const room = this.leaveInstead ?? this.#kakao.rooms_.find((candidate) => chatListName(candidate) === name)?.chatId;
      if (room) this.#kakao.removeRoom(room);
    }
    return { detail: this.leaveStage, stage: this.leaveStage };
  }
}

// kakaocli send: types into the first room whose name contains the given name, as
// kakaocli does, unless `into` sends it somewhere else or `attempt` fails it.
export class FakeMessenger implements Messenger {
  readonly sent: { readonly name: string; readonly text: string; readonly chatId: string | null }[] = [];
  into: string | null = null;
  attempt: SendAttempt = { status: "sent" };
  land = true;
  readonly #kakao: FakeKakao;

  constructor(kakao: FakeKakao) {
    this.#kakao = kakao;
  }

  async send(name: string, text: string) {
    const room =
      this.into ??
      this.#kakao.rooms_.find((candidate) => chatListName(candidate).toLowerCase().includes(name.toLowerCase()))?.chatId ??
      null;
    const typed = this.attempt.status === "sent" || this.attempt.status === "error";
    this.sent.push({ chatId: typed ? room : null, name, text });
    if (typed && room && this.land) this.#kakao.add(room, this.#kakao.account, text);
    return this.attempt;
  }
}
