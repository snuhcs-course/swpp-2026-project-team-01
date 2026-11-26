import { type KakaoReader, logIdAfter, type Room } from "./kakao-db.ts";
import { chatListName, chatListPicks, memberRooms, nameIsUnique, sendableGroupRooms, sendableRooms } from "./rooms.ts";

// Sending and leaving with the wrong-room checks (host-kakaotalk-mac-relay
// designs 5 and 7). kakaocli opens a chat by name, never by room ID, so:
//   1. the room must be sendable now (its name picks it and no other room in
//      the database, and for a 1:1 room the other person wrote first);
//   2. just before sending, exactly one chat-list label must contain the
//      name, and that label must be the name;
//   3. after sending, the text must appear from the account in that room.
// A message that shows up in another room is uncertain with reason
// wrong_room, which the service records as an alert.

export type Outcome = {
  readonly outcome: "accepted" | "failed" | "uncertain" | "not_started";
  readonly reason?: "wrong_room";
  // For the log only: never message text.
  readonly detail: string;
};

export type SendAttempt =
  | { readonly status: "sent" }
  // Nothing was typed: no chat-list row matched.
  | { readonly status: "chat_not_found"; readonly detail: string }
  // Nothing was typed: no window, or no input field in the opened chat.
  | { readonly status: "not_started"; readonly detail: string }
  // Anything else, a crash or a timeout: the text may have been typed.
  | { readonly status: "error"; readonly detail: string };

export interface Messenger {
  send(name: string, text: string): Promise<SendAttempt>;
}

export type LeaveAttempt = {
  // not_found: no single row; no_menu or no_item: nothing pressed; pressed:
  // leave pressed and confirmed in the alert, which may or may not have taken.
  readonly stage: "not_found" | "no_menu" | "no_item" | "no_confirm" | "pressed";
  readonly detail: string;
};

export type Probe = {
  readonly trusted: boolean;
  readonly locked: boolean;
  readonly kakaoRunning: boolean;
  readonly kakaoVersion: string | null;
};

export interface Ui {
  probe(): Promise<Probe>;
  // The chat list's name labels, or null when the list cannot be read.
  chatListNames(): Promise<string[] | null>;
  leave(name: string): Promise<LeaveAttempt>;
}

export type DeliveryDeps = {
  readonly db: KakaoReader;
  readonly ui: Ui;
  readonly messenger: Messenger;
  readonly myUserId: string;
  readonly sleep: (ms: number) => Promise<void>;
  // How long the landing check looks, and how often.
  readonly landingMs?: number;
  readonly landingStepMs?: number;
};

const same = (a: string, b: string) => a === b || a.trim() === b.trim();

// Looks for the sent text from the account after `before`: in the room, in another room, or nowhere.
async function landing(deps: DeliveryDeps, roomId: string, text: string, before: string): Promise<"room" | "other" | "none"> {
  const deadline = deps.landingMs ?? 10_000;
  const step = deps.landingStepMs ?? 1_000;
  for (let waited = 0; ; waited += step) {
    const own = (await deps.db.ownMessagesAfter(deps.myUserId, before)).filter((message) => logIdAfter(message.logId, before) && same(message.text, text));
    if (own.some((message) => message.chatId !== roomId)) return "other";
    if (own.some((message) => message.chatId === roomId)) return "room";
    if (waited >= deadline) return "none";
    await deps.sleep(step);
  }
}

async function checkedName(deps: DeliveryDeps, room: Room, rooms: readonly Room[]): Promise<{ name: string } | Outcome> {
  const name = chatListName(room);
  const labels = await deps.ui.chatListNames();
  if (labels === null) return { detail: "chat list unavailable", outcome: "not_started" };
  if (!chatListPicks(name, labels)) return { detail: "chat list does not show the name exactly once", outcome: "failed" };
  if (!nameIsUnique(room, rooms)) return { detail: "name not unique", outcome: "failed" };
  return { name };
}

export async function sendToRoom(deps: DeliveryDeps, roomId: string, text: string): Promise<Outcome> {
  const rooms = await deps.db.rooms();
  const room = [...sendableRooms(rooms), ...sendableGroupRooms(rooms)].find((candidate) => candidate.chatId === roomId);
  if (!room) return { detail: "room not sendable", outcome: "failed" };
  const checked = await checkedName(deps, room, rooms);
  if ("outcome" in checked) return checked;

  const before = await deps.db.maxLogId();
  const attempt = await deps.messenger.send(checked.name, text);
  if (attempt.status === "chat_not_found") return { detail: attempt.detail, outcome: "failed" };
  if (attempt.status === "not_started") return { detail: attempt.detail, outcome: "not_started" };

  // From here the text may have gone out: any error is uncertain, never a retry.
  let landed: "room" | "other" | "none";
  try {
    landed = await landing(deps, roomId, text, before);
  } catch (error) {
    return { detail: `landing check failed: ${error instanceof Error ? error.message : "error"}`, outcome: "uncertain" };
  }
  if (landed === "other") return { detail: "message found in another room", outcome: "uncertain", reason: "wrong_room" };
  if (landed === "room") return { detail: attempt.status === "sent" ? "landed" : `landed after ${attempt.detail}`, outcome: "accepted" };
  return { detail: attempt.status === "sent" ? "not seen in the database" : attempt.detail, outcome: "uncertain" };
}

export async function leaveRoom(deps: DeliveryDeps, roomId: string): Promise<Outcome> {
  const rooms = await deps.db.rooms();
  const room = memberRooms(rooms).find((candidate) => candidate.chatId === roomId);
  // Already gone: the account is not in the room, which is what was asked.
  if (!room) return { detail: "not a member", outcome: "accepted" };
  const checked = await checkedName(deps, room, rooms);
  if ("outcome" in checked) return checked;

  const others = rooms.filter((candidate) => candidate.chatId !== roomId).map((candidate) => candidate.chatId);
  const attempt = await deps.ui.leave(checked.name);
  if (attempt.stage !== "pressed" && attempt.stage !== "no_confirm") return { detail: attempt.detail, outcome: attempt.stage === "not_found" ? "failed" : "not_started" };

  const deadline = deps.landingMs ?? 10_000;
  const step = deps.landingStepMs ?? 1_000;
  for (let waited = 0; ; waited += step) {
    const after = new Set((await deps.db.rooms()).map((candidate) => candidate.chatId));
    // Another room vanished: the helper left the wrong one. Final, so it is never retried.
    if (others.some((chatId) => !after.has(chatId))) return { detail: "another room disappeared", outcome: "failed" };
    if (!after.has(roomId)) return { detail: "left", outcome: "accepted" };
    // Leaving twice does no harm, so a room still listed is tried again rather than given up as uncertain.
    if (waited >= deadline) return { detail: attempt.stage === "no_confirm" ? "leave not confirmed" : "room still listed", outcome: "not_started" };
    await deps.sleep(step);
  }
}
