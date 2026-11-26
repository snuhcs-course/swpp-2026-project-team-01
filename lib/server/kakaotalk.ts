import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "./photon-receiver";

// The KakaoTalk relay protocol (host-kakaotalk-channel design 2 and 3, D2 and
// D3). KakaoTalk has no API for a personal account, so a relay app on a
// team-owned Android phone reads KakaoTalk's notifications and talks to the
// service over four signed routes (agent/channels/kakaotalk.ts):
//   POST /kakaotalk/webhook               one event per 1:1 message, or void_code
//   POST /kakaotalk/outbox/claim          the next message to send, leased
//   POST /kakaotalk/outbox/:id/result     how a claimed message ended
//   POST /kakaotalk/heartbeat             the relay's health, every minute
// Every request carries X-FMAT-Relay-Timestamp (Unix seconds), X-FMAT-Relay-Nonce
// (16 random bytes in hex) and X-FMAT-Relay-Signature, the hex HMAC-SHA256 of
// `METHOD\npath\ntimestamp\nnonce\nbody`. The webhook is signed with
// KAKAOTALK_RELAY_INBOUND_SECRET; the outbox, result and heartbeat routes with
// KAKAOTALK_RELAY_OUTBOX_SECRET, so a stolen inbound secret can inject messages
// but never read a queue. Each also accepts its _PREVIOUS value while a secret
// is rotated. A route class without a secret refuses every request.
//
// The sender is the KakaoTalk room ID of the 1:1 chat, from the notification's
// tag; it is hashed as kakaotalk:<room ID> (channelHash) and sealed for replies.
// The sender's profile name comes from the notification, never from text, and is
// sealed with the text as one JSON envelope, as Telegram's profile is. Group and
// open-chat text never leaves the phone: a link code seen there arrives as
// void_code with only the code's HMAC under the inbound secret.

type Environment = Readonly<Record<string, string | undefined>>;

export const KAKAOTALK_WEBHOOK_ID = "kakaotalk";
export const RELAY_TIMESTAMP_HEADER = "x-fmat-relay-timestamp";
export const RELAY_NONCE_HEADER = "x-fmat-relay-nonce";
export const RELAY_SIGNATURE_HEADER = "x-fmat-relay-signature";
// A signed request is accepted within five minutes of its timestamp, and its
// nonce is remembered for ten, so a replay inside the window is refused.
export const RELAY_TOLERANCE_SECONDS = 5 * 60;
export const RELAY_NONCE_MINUTES = 10;
export const MAX_RELAY_BODY_BYTES = 64 * 1024;
// The longest message text the webhook takes; longer text is refused as too long later.
export const KAKAOTALK_TEXT_LIMIT = 10_000;

// The outbox (design 5): a claim holds one message for 120 seconds; a message
// the relay could not start goes back to the queue at most three times; a chat
// with no posted notification gets at most one nudge an hour; a claim waits up
// to 25 seconds for work.
export const KAKAOTALK_LEASE_SECONDS = 120;
export const KAKAOTALK_REQUEUES = 3;
export const KAKAOTALK_NUDGE_MINUTES = 60;
export const KAKAOTALK_CLAIM_WAIT_MS = 25_000;

// The fixed nudge (design 1): no request, person, time or place, so the chat a
// name opens may be the wrong one without anything private reaching it.
export const KAKAOTALK_NUDGE_TEXT = "Find Me a Time에 새 소식이 있어요. 아무 말이나 답장해 주시면 바로 보내드릴게요.";

export type RelayRouteClass = "inbound" | "outbox";

// The two relays behind the same routes (host-kakaotalk-mac-relay design 1):
// the Android phone and KakaoTalk for Mac. Each Mac body says "relay": "mac"
// inside the signed body; a body without it is the phone's. Only the relay that
// KAKAOTALK_ACTIVE_RELAY names may post events, claim or beat; the other is
// answered 409 standby. The default is the phone, so its app needs no release.
export type RelayKind = "android" | "mac";

export function activeRelayOf(env: Environment): RelayKind {
  return env.KAKAOTALK_ACTIVE_RELAY?.trim().toLowerCase() === "mac" ? "mac" : "android";
}

// The relay a parsed body names, or null for a value that is not a relay.
export function relayOfBody(payload: unknown): RelayKind | null {
  if (!payload || typeof payload !== "object") return null;
  const relay = (payload as Record<string, unknown>).relay;
  if (relay === undefined) return "android";
  return relay === "android" || relay === "mac" ? relay : null;
}

export type KakaoTalkConfig = {
  // The product's KakaoTalk ID the card shows (KAKAOTALK_ACCOUNT_ID); KakaoTalk is
  // not configured without one.
  readonly accountId: string;
  // The current secret first, then the previous one, for each route class.
  readonly inboundSecrets: readonly string[];
  readonly outboxSecrets: readonly string[];
  // The relay the service acts on (KAKAOTALK_ACTIVE_RELAY, default android).
  readonly activeRelay: RelayKind;
};

function secretsOf(env: Environment, name: string) {
  return [env[name]?.trim(), env[`${name}_PREVIOUS`]?.trim()].filter((value): value is string => Boolean(value));
}

export function kakaotalkConfig(env: Environment = process.env): KakaoTalkConfig {
  return {
    accountId: env.KAKAOTALK_ACCOUNT_ID?.trim() ?? "",
    inboundSecrets: secretsOf(env, "KAKAOTALK_RELAY_INBOUND_SECRET"),
    outboxSecrets: secretsOf(env, "KAKAOTALK_RELAY_OUTBOX_SECRET"),
    activeRelay: activeRelayOf(env),
  };
}

// The account ID the card links to, or "" while KakaoTalk is not configured:
// it needs the account ID and both current relay secrets, so a deployment
// halfway set up never offers a channel whose relay it would refuse.
export function kakaotalkAccountIdIfConfigured(env: Environment = process.env) {
  const configured = Boolean(env.KAKAOTALK_RELAY_INBOUND_SECRET?.trim() && env.KAKAOTALK_RELAY_OUTBOX_SECRET?.trim());
  return configured ? (env.KAKAOTALK_ACCOUNT_ID?.trim() ?? "") : "";
}

export function relaySecrets(config: KakaoTalkConfig, routeClass: RelayRouteClass) {
  return routeClass === "inbound" ? config.inboundSecrets : config.outboxSecrets;
}

export function relayCanonical(method: string, path: string, timestamp: string, nonce: string, body: string) {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}`;
}

export function relaySignature(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string) {
  return createHmac("sha256", secret).update(relayCanonical(method, path, timestamp, nonce, body), "utf8").digest("hex");
}

export type SignedRelayRequest = {
  readonly method: string;
  // The request path exactly as sent, without the query.
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
};

const NONCE = /^[0-9a-f]{32}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

// The request's nonce when its signature verifies under one of the secrets and
// its timestamp is within five minutes; otherwise null. Every secret is
// compared, in constant time, whichever one matches.
export function verifyRelaySignature(
  secrets: readonly string[],
  request: SignedRelayRequest,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  const timestamp = request.headers.get(RELAY_TIMESTAMP_HEADER) ?? "";
  const nonce = request.headers.get(RELAY_NONCE_HEADER) ?? "";
  const presented = request.headers.get(RELAY_SIGNATURE_HEADER) ?? "";

  if (secrets.length === 0) return null;
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > RELAY_TOLERANCE_SECONDS) return null;
  if (!NONCE.test(nonce) || !SIGNATURE.test(presented)) return null;

  const given = Buffer.from(presented, "hex");
  let matched = false;
  for (const secret of secrets) {
    const expected = Buffer.from(relaySignature(secret, request.method, request.path, timestamp, nonce, request.body), "hex");
    if (timingSafeEqual(expected, given)) matched = true;
  }
  return matched ? nonce : null;
}

// The headers a relay request carries; the stand-in and the tests sign with it.
export function relayHeaders(secret: string, method: string, path: string, body: string, timestamp: number, nonce: string) {
  const seconds = String(timestamp);
  return {
    "content-type": "application/json",
    [RELAY_NONCE_HEADER]: nonce,
    [RELAY_SIGNATURE_HEADER]: relaySignature(secret, method, path, seconds, nonce, body),
    [RELAY_TIMESTAMP_HEADER]: seconds,
  };
}

// ---------------------------------------------------------------------------
// Events (design 3)

export type KakaoTalkDetails = {
  // The sender's KakaoTalk profile name, from the notification's sender.
  readonly displayName: string | null;
};

export type KakaoTalkEvent =
  // A 1:1 message, stored as a receipt; payloadSha256 covers what identifies it.
  | { readonly kind: "message"; readonly message: InboundMessage; readonly payloadSha256: string }
  // A group or open-chat message, which the relay should never send: nothing is stored.
  | { readonly kind: "group" }
  // A link code seen in a group or open chat, as its HMAC under the inbound secret.
  | { readonly kind: "void_code"; readonly codeHash: string };

// A room ID as the notification tag carries it (<account>_<room ID>), and an
// event ID: <room ID>:<post time in ms>:<index among messages of that time>.
// The Mac relay reads the database instead and names a message by its log ID:
// <chatId>:log:<logId> (host-kakaotalk-mac-relay design 3); chatId is the
// same number as the phone's room ID.
const ROOM_ID = /^\d{1,40}$/;
const EVENT_ID = /^(\d{1,40}):(\d{1,15}):(\d{1,4})$/;
const MAC_EVENT_ID = /^(\d{1,40}):log:(\d{1,20})$/;
const MAC_MEMBERS_EVENT_ID = /^(\d{1,40}):members:(\d{1,20})$/;
const USER_ID = /^\d{1,20}$/;

function postedAt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value);
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value);
  return null;
}

function displayName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = Array.from(value.normalize("NFC"))
    .filter((char) => char.charCodeAt(0) > 0x1f && char !== "\u007f")
    .join("")
    .trim()
    .slice(0, 64);
  return name || null;
}

// The relay event a webhook body carries, or null when it is not one:
//   { eventId, roomId, isGroup, senderName, text, postedAt, nonText? } for a
//   message, where eventId starts with the room ID; from the Mac relay also
//   senderUserId (validated, not stored) and the log-form event ID;
//   { kind: "void_code", eventId, codeHash } for a code seen in a group;
//   { relay: "mac", kind: "room_members", eventId, roomId, memberUserIds,
//   activeMembersCount } for a group's member list, which stores nothing until
//   the group change consumes it (host-kakaotalk-mac-relay design 4).
export function parseKakaoTalkEvent(payload: unknown): KakaoTalkEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as Record<string, unknown>;
  const relay = relayOfBody(event);
  if (!relay) return null;

  if (event.kind === "void_code") {
    return typeof event.codeHash === "string" && SIGNATURE.test(event.codeHash) ? { codeHash: event.codeHash, kind: "void_code" } : null;
  }
  if (event.kind === "room_members") {
    const id = relay === "mac" && typeof event.eventId === "string" ? MAC_MEMBERS_EVENT_ID.exec(event.eventId) : null;
    const members = event.memberUserIds;
    const valid =
      id &&
      id[1] === event.roomId &&
      Array.isArray(members) &&
      members.length <= 1000 &&
      members.every((member) => typeof member === "string" && USER_ID.test(member)) &&
      Number.isInteger(event.activeMembersCount);
    return valid ? { kind: "group" } : null;
  }
  if (event.kind !== undefined && event.kind !== "message") return null;
  if (event.isGroup === true || event.isOpenChat === true) return { kind: "group" };
  if (event.isGroup !== false) return null;
  if (event.senderUserId !== undefined && !(relay === "mac" && typeof event.senderUserId === "string" && USER_ID.test(event.senderUserId))) return null;

  const eventId = typeof event.eventId === "string" ? (relay === "mac" ? MAC_EVENT_ID : EVENT_ID).exec(event.eventId) : null;
  const roomId = typeof event.roomId === "string" && ROOM_ID.test(event.roomId) ? event.roomId : null;
  if (!eventId || !roomId || eventId[1] !== roomId) return null;

  const nonText = event.nonText === true;
  const text = !nonText && typeof event.text === "string" && event.text.length > 0 && event.text.length <= KAKAOTALK_TEXT_LIMIT ? event.text : null;
  if (!nonText && text === null) return null;
  const name = displayName(event.senderName);
  const sentAt = postedAt(event.postedAt);

  return {
    kind: "message",
    message: {
      channel: "kakaotalk",
      contentType: nonText ? "attachment" : "text",
      kakaotalk: { displayName: name },
      messageId: `kakaotalk:${event.eventId as string}`,
      sender: roomId,
      sentAt,
      spaceId: roomId,
      spaceType: "dm",
      text,
    },
    // The same message always hashes the same, whatever the JSON's key order.
    payloadSha256: createHash("sha256")
      .update(JSON.stringify([event.eventId, roomId, name, text, sentAt?.toISOString() ?? null, nonText]), "utf8")
      .digest("hex"),
  };
}

// The text a KakaoTalk receipt seals: the message text with the sender's name.
export function sealedKakaoTalkText(text: string | null, details: KakaoTalkDetails) {
  return JSON.stringify({ displayName: details.displayName, text });
}

export function openKakaoTalkText(sealed: string): { readonly text: string | null; readonly details: KakaoTalkDetails } | null {
  let value: unknown;
  try {
    value = JSON.parse(sealed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  return {
    details: { displayName: typeof envelope.displayName === "string" ? envelope.displayName : null },
    text: typeof envelope.text === "string" ? envelope.text : null,
  };
}

// The void_code hash of a link code: its HMAC under the inbound secret.
export function kakaotalkCodeHash(secret: string, code: string) {
  return createHmac("sha256", secret).update(code.toUpperCase(), "utf8").digest("hex");
}

export function codeHashMatches(secrets: readonly string[], code: string, presented: string) {
  const given = Buffer.from(presented, "hex");
  let matched = false;
  for (const secret of secrets) {
    if (timingSafeEqual(Buffer.from(kakaotalkCodeHash(secret, code), "hex"), given)) matched = true;
  }
  return matched;
}

// A lease token's stored form.
export function leaseTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
