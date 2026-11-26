import { describe, expect, it } from "vitest";
import { eventsFor } from "./events.ts";
import { newRoomMessagesSql, parseMessages, parseRooms, roomKind, roomMessagesSql, type Room } from "./kakao-db.ts";
import { chatListName, chatListPicks, memberRooms, nameIsUnique, sendableGroupRooms, sendableRooms, sortedIds } from "./rooms.ts";
import { codeHash } from "./signer.ts";
import { RECORDED } from "./testing.ts";

// The database rows recorded on the Mac mini (fixtures/db), the room rules
// (host-kakaotalk-mac-relay designs 2, 5 and 6) and the events they give (design 4).

const rooms = parseRooms(RECORDED.rooms());
const messages = parseMessages(RECORDED.messages());
const room = (chatId: string) => rooms.find((candidate) => candidate.chatId === chatId)!;
const options = { groupEvents: false, inboundSecret: "inbound", myUserId: RECORDED.account };

function direct(chatId: string, name: string, wrote = true): Room {
  return { activeMembersCount: 2, chatId, chatName: "", directMemberUserId: `9${chatId}`, kind: "direct", lastLogId: "1", memberNames: [name], memberUserIds: [], memberWrote: wrote };
}

describe("recorded rooms", () => {
  it("reads kinds, names, members and whether the friend wrote", () => {
    expect(room(RECORDED.hostRoom)).toMatchObject({ chatName: "", directMemberUserId: RECORDED.host, kind: "direct", memberNames: ["Test Host"], memberUserIds: [RECORDED.host], memberWrote: true });
    expect(room(RECORDED.group)).toMatchObject({ activeMembersCount: 5, chatName: "테스트 그룹", kind: "group" });
    expect(room(RECORDED.kakaoAccount).kind).toBe("other");
    // 19-digit log IDs survive as text.
    expect(room(RECORDED.hostRoom).lastLogId).toBe("3982372862361772034");
    expect(messages.find((message) => message.type === 1999)?.sentAt).toBeCloseTo(1795670448.638871);
  });

  it("treats a room with an open link as a group, and unknown types as other", () => {
    expect(roomKind(0, "0")).toBe("direct");
    expect(roomKind(0, "12345")).toBe("group");
    expect(roomKind(1, "0")).toBe("group");
    expect(roomKind(2, "0")).toBe("other");
    expect(roomKind(5, "0")).toBe("other");
  });

  it("splices only decimal IDs into SQL", () => {
    expect(roomMessagesSql(RECORDED.hostRoom, "3982372862361772034")).toContain("m.logId > 3982372862361772034");
    expect(() => roomMessagesSql("1 OR 1=1", "0")).toThrow();
    expect(() => newRoomMessagesSql("1; DROP", 0)).toThrow();
  });
});

describe("room rules", () => {
  it("lists the recorded 1:1 room as sendable and the group as a member room", () => {
    expect(sendableRooms(rooms).map((candidate) => candidate.chatId)).toEqual([RECORDED.hostRoom]);
    expect(memberRooms(rooms).map((candidate) => candidate.chatId)).toEqual([RECORDED.group]);
  });

  it("refuses a name that another room's name contains, ignoring case", () => {
    const kim = direct("1", "Kim");
    const all = [kim, direct("2", "kim Jisoo"), direct("3", "Lee")];
    expect(nameIsUnique(kim, all)).toBe(false);
    expect(sendableRooms(all).map((candidate) => candidate.chatId)).toEqual(["2", "3"]);
    // A group title counts as a name too.
    expect(nameIsUnique(all[2]!, [...all, { ...direct("4", ""), chatName: "Lee's study group", kind: "group" }])).toBe(false);
  });

  it("counts an untitled group's member names, which make up its chat-list label", () => {
    const users = new Map([[RECORDED.host, ["Test Host"]], ["900000003", ["Kim"]]]);
    const withNames = parseRooms(RECORDED.rooms().map((row) => (row[0] === RECORDED.group ? [...row.slice(0, 3), "", ...row.slice(4)] : row)), users);
    const group = withNames.find((candidate) => candidate.chatId === RECORDED.group)!;
    expect(group.memberNames).toEqual(["Kim", "Test Host"]);
    expect(chatListName(group)).toBe("");
    // "Test Host" now also appears in the untitled group's label.
    expect(sendableRooms(withNames)).toEqual([]);
    // With its recorded title the group is listed under the title alone, as on the Mac mini.
    expect(sendableRooms(parseRooms(RECORDED.rooms(), users)).map((candidate) => candidate.chatId)).toEqual([RECORDED.hostRoom]);
  });

  it("caps and filters the listed room IDs", () => {
    const many = Array.from({ length: 1600 }, (_, index) => direct(String(index + 1), `Name ${index}`));
    expect(sortedIds(many)).toHaveLength(1500);
    expect(sortedIds([direct("-5", "Negative")])).toEqual([]);
  });

  it("never lists a 1:1 room whose other member has not written", () => {
    expect(sendableRooms([direct("1", "Never Wrote", false)])).toEqual([]);
  });

  it("never lists a room without a name", () => {
    expect(sendableRooms([direct("1", "")])).toEqual([]);
    expect(chatListName(direct("1", "  Padded  "))).toBe("Padded");
  });

  it("checks the chat list just before sending", () => {
    const { names } = RECORDED.rows();
    expect(chatListPicks("Test Host", names)).toBe(true);
    expect(chatListPicks("test host", names)).toBe(false);
    expect(chatListPicks("Test Host", [...names, "Test Hostess"])).toBe(false);
    expect(chatListPicks("Test Host", ["테스트 그룹"])).toBe(false);
  });
});

describe("events", () => {
  const byText = (text: string) => messages.find((message) => message.text === text)!;

  it("forwards the friend's 1:1 text with the log-form ID and user ID", () => {
    const [event] = eventsFor(byText("안녕하세요!"), room(RECORDED.hostRoom), options);
    expect(event).toEqual({
      eventId: `${RECORDED.hostRoom}:log:3981993139986153473`,
      isGroup: false,
      logId: "3981993139986153473",
      postedAt: "2026-11-25T17:29:33.000Z",
      relay: "mac",
      roomId: RECORDED.hostRoom,
      senderName: "Test Host",
      senderUserId: RECORDED.host,
      text: "안녕하세요!",
    });
  });

  it("forwards nothing the account wrote, and nothing from 카카오계정", () => {
    expect(eventsFor(byText("ssh 테스트"), room(RECORDED.hostRoom), options)).toEqual([]);
    expect(eventsFor(byText("카카오톡 로그인 알림"), room(RECORDED.kakaoAccount), options)).toEqual([]);
  });

  it("marks a non-text 1:1 message and sends no text for it", () => {
    const [event] = eventsFor({ ...byText("hi"), type: 2, text: "photo.jpg" }, room(RECORDED.hostRoom), options);
    expect(event).toMatchObject({ nonText: true, text: "" });
  });

  it("sends no group text, only the hash of a code seen there", () => {
    const groupText = messages.find((message) => message.chatId === RECORDED.group && message.type === 1 && message.authorId === RECORDED.host)!;
    expect(eventsFor(groupText, room(RECORDED.group), options)).toEqual([]);
    const coded = { ...groupText, text: "fmat-7k3q9m2xwa" };
    expect(eventsFor(coded, room(RECORDED.group), options)).toEqual([
      { codeHash: codeHash("inbound", "FMAT-7K3Q9M2XWA"), eventId: `void:${RECORDED.group}:log:${coded.logId}:0`, kind: "void_code", relay: "mac" },
    ]);
  });

  it("sends a member's group text, with the room's title and the member's name, when group messages are on", () => {
    const groupText = messages.find((message) => message.chatId === RECORDED.group && message.type === 1 && message.authorId === RECORDED.host)!;
    const [event] = eventsFor(groupText, room(RECORDED.group), { ...options, groupMessages: true, namesOf: () => ["Test Host"] });
    expect(event).toEqual({
      eventId: `${RECORDED.group}:log:${groupText.logId}`,
      kind: "group_message",
      postedAt: new Date(groupText.sentAt * 1000).toISOString(),
      relay: "mac",
      roomId: RECORDED.group,
      roomName: "테스트 그룹",
      senderName: "Test Host",
      senderUserId: RECORDED.host,
      text: groupText.text,
    });
    // A code never leaves as text, only as its hash.
    expect(eventsFor({ ...groupText, text: "FMAT-7K3Q9M2XWA" }, room(RECORDED.group), { ...options, groupMessages: true }).map((e) => e.kind)).toEqual(["void_code"]);
  });

  it("lists a titled group whose title no other room contains as sendable, and never an untitled one", () => {
    expect(sendableGroupRooms(rooms).map((candidate) => candidate.chatId)).toEqual([RECORDED.group]);
    expect(sendableGroupRooms([...rooms, { ...direct("9", "테스트 그룹 친구") }])).toEqual([]);
    expect(sendableGroupRooms([{ ...direct("8", ""), kind: "group", memberNames: ["Kim"] }])).toEqual([]);
  });

  it("sends a group's member IDs for its invitation feed only when membership events are on", () => {
    const feed = messages.find((message) => message.type === 0)!;
    expect(eventsFor(feed, room(RECORDED.group), options)).toEqual([]);
    expect(eventsFor(feed, room(RECORDED.group), { ...options, groupEvents: true })).toEqual([
      {
        activeMembersCount: 5,
        eventId: `${RECORDED.group}:members:${feed.logId}`,
        kind: "room_members",
        memberUserIds: ["900000003", "900000004", RECORDED.host, "900000005"],
        relay: "mac",
        roomId: RECORDED.group,
      },
    ]);
  });
});
