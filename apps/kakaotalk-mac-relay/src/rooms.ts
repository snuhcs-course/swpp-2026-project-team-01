import type { Room } from "./kakao-db.ts";

// Which rooms the Mac relay may send to (host-kakaotalk-mac-relay designs 5
// and 6). `kakaocli send` opens the first chat-list row whose name label
// contains the given name, ignoring case, so a room is sendable only when no
// other room's name contains its name. A 1:1 room is also sendable only after
// the other person wrote in it, so the relay never writes first.

// The name the chat list shows for a room: a group's title, else the friend's name.
// An untitled group has no name of its own: its label lists members, and the
// relay never addresses it by name.
export function chatListName(room: Room) {
  return (room.kind === "group" ? room.chatName : room.chatName || room.memberNames[0] || "").trim();
}

// Names as kakaocli compares them (Swift's localizedCaseInsensitiveContains):
// NFC, lower case.
function folded(name: string) {
  return name.normalize("NFC").toLowerCase();
}

// Every name another room might be listed under.
function namesOf(room: Room) {
  return [room.chatName, ...room.memberNames].map((name) => name.trim()).filter((name) => name !== "");
}

// Whether a name picks this room and no other under kakaocli's rule.
export function nameIsUnique(room: Room, rooms: readonly Room[]) {
  const name = chatListName(room);
  if (!name) return false;
  const needle = folded(name);
  return !rooms.some((other) => other.chatId !== room.chatId && namesOf(other).some((candidate) => folded(candidate).includes(needle)));
}

// The 1:1 rooms a reply may go to: the other person wrote, and the name is unique.
export function sendableRooms(rooms: readonly Room[]) {
  return rooms.filter((room) => room.kind === "direct" && room.memberWrote && nameIsUnique(room, rooms));
}

// The group rooms a reply may go to (kakaotalk-group-conversations design 4): a
// titled group whose title no other room's name contains. An untitled group's
// label lists its members, so it cannot be addressed.
export function sendableGroupRooms(rooms: readonly Room[]) {
  return rooms.filter((room) => room.kind === "group" && room.chatName.trim() !== "" && nameIsUnique(room, rooms));
}

// The group rooms the account is in, for leave claims (design 7).
export function memberRooms(rooms: readonly Room[]) {
  return rooms.filter((room) => room.kind === "group");
}

// The most room IDs a claim or heartbeat lists; the service takes up to 3,000, and two full lists stay under its 64 KB body limit.
export const MAX_LISTED_ROOMS = 1_500;

// Room IDs as the service takes them: non-negative decimals, sorted, capped.
export function sortedIds(rooms: readonly Room[]) {
  return rooms
    .map((room) => room.chatId)
    .filter((chatId) => /^\d{1,40}$/.test(chatId))
    .sort()
    .slice(0, MAX_LISTED_ROOMS);
}

// The chat-list check just before a send (design 5, check 2): exactly one
// label contains the name, and that label is the name.
export function chatListPicks(name: string, labels: readonly string[]) {
  const needle = folded(name);
  const matches = labels.filter((label) => folded(label).includes(needle));
  return matches.length === 1 && matches[0]!.trim() === name;
}
