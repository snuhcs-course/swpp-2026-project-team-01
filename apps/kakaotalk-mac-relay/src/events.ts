import type { DbMessage, Room } from "./kakao-db.ts";
import { codeHash, linkCodes } from "./signer.ts";

// Webhook events from database messages (host-kakaotalk-mac-relay design 4).
// Each event carries "relay": "mac", which the signature covers.
//   1:1 message from the other person: a message event with the room ID, the
//     log-form event ID, the sender's user ID and name, and the text.
//   Group or open-chat message: no text; each link code in it becomes a
//     void_code event with only the code's HMAC.
//   Group feed (type 0) with membership events on: the room's member IDs.
// Messages the account wrote, and messages in other rooms (카카오계정), give nothing.

export type WebhookEvent = Readonly<Record<string, unknown>> & { readonly eventId: string };

export type EventOptions = {
  readonly myUserId: string;
  readonly inboundSecret: string;
  readonly groupEvents: boolean;
};

const TEXT_TYPE = 1;
const FEED_TYPE = 0;

export function eventsFor(message: DbMessage, room: Room | undefined, options: EventOptions): WebhookEvent[] {
  if (!room || message.authorId === options.myUserId) return [];

  if (room.kind === "direct") {
    // Only the other person's messages; a system row (author 0) is neither.
    if (message.authorId !== room.directMemberUserId) return [];
    const nonText = message.type !== TEXT_TYPE;
    return [
      {
        eventId: `${room.chatId}:log:${message.logId}`,
        isGroup: false,
        logId: message.logId,
        postedAt: new Date(Math.round(message.sentAt * 1000)).toISOString(),
        relay: "mac",
        roomId: room.chatId,
        senderName: room.memberNames[0] ?? "",
        senderUserId: message.authorId,
        text: nonText ? "" : message.text,
        ...(nonText ? { nonText: true } : {}),
      },
    ];
  }

  if (room.kind === "group") {
    const events: WebhookEvent[] = [];
    if (message.type === TEXT_TYPE) {
      linkCodes(message.text).forEach((code, index) => {
        events.push({ codeHash: codeHash(options.inboundSecret, code), eventId: `void:${room.chatId}:log:${message.logId}:${index}`, kind: "void_code", relay: "mac" });
      });
    }
    if (message.type === FEED_TYPE && options.groupEvents) {
      events.push({
        activeMembersCount: room.activeMembersCount,
        eventId: `${room.chatId}:members:${message.logId}`,
        kind: "room_members",
        memberUserIds: [...room.memberUserIds],
        relay: "mac",
        roomId: room.chatId,
      });
    }
    return events;
  }

  return [];
}
