import { describe, expect, it } from "vitest";
import {
  codeHashMatches,
  KAKAOTALK_NUDGE_TEXT,
  kakaotalkAccountIdIfConfigured,
  kakaotalkCodeHash,
  kakaotalkConfig,
  openKakaoTalkText,
  parseKakaoTalkEvent,
  RELAY_NONCE_HEADER,
  RELAY_SIGNATURE_HEADER,
  RELAY_TIMESTAMP_HEADER,
  relayHeaders,
  relaySignature,
  sealedKakaoTalkText,
  verifyRelaySignature,
} from "./kakaotalk";
import { channelHash } from "./photon-receiver";

// The KakaoTalk relay protocol (host-kakaotalk-channel design 2 and 3): the
// signature over method, path, timestamp, nonce and body with two secrets per
// route class, the 1:1 message and void_code events, and the sender's own hash
// namespace. The vectors are the relay app's (apps/kakaotalk-relay/PROTOCOL.md).

const webhookBody =
  '{"eventId":"486083133936417:1795662000123:0","roomId":"486083133936417","isGroup":false,"senderName":"Test Host","text":"hello","postedAt":"2026-11-26T03:00:00.123Z"}';
const nonce = "00112233445566778899aabbccddeeff";

function signed(secret: string, path: string, body: string, timestamp = 1795662000) {
  return { body, headers: new Headers(relayHeaders(secret, "POST", path, body, timestamp, nonce)), method: "POST", path };
}

describe("relay signature", () => {
  it("matches the relay app's known answer", () => {
    expect(relaySignature("test-inbound-secret", "POST", "/kakaotalk/webhook", "1795662000", nonce, webhookBody)).toBe(
      "83ea0d183792ab410a9b1795d8837af1c85087b3c04263f43d8358b7117a90e9",
    );
  });

  it("matches the relay app's claim vector", () => {
    expect(
      relaySignature("test-outbox-secret", "POST", "/kakaotalk/outbox/claim", "1795662000", "ffeeddccbbaa99887766554433221100", '{"postedRooms":["486083133936417"],"locked":false}'),
    ).toBe("c7760506fd48489399251e46543b56529c93fc1a425b560bc9d46ac7e205e7a5");
  });

  it("accepts a correctly signed request within five minutes and returns its nonce", () => {
    expect(verifyRelaySignature(["s1"], signed("s1", "/kakaotalk/webhook", webhookBody), 1795662000 + 299)).toBe(nonce);
  });

  it("refuses a signature made for another route, body, secret or time", () => {
    const request = signed("s1", "/kakaotalk/webhook", webhookBody);
    expect(verifyRelaySignature(["s1"], { ...request, path: "/kakaotalk/outbox/claim" }, 1795662000)).toBeNull();
    expect(verifyRelaySignature(["s1"], { ...request, body: `${webhookBody} ` }, 1795662000)).toBeNull();
    expect(verifyRelaySignature(["s1"], { ...request, method: "PUT" }, 1795662000)).toBeNull();
    expect(verifyRelaySignature(["other"], request, 1795662000)).toBeNull();
    expect(verifyRelaySignature(["s1"], request, 1795662000 + 301)).toBeNull();
    expect(verifyRelaySignature(["s1"], request, 1795662000 - 301)).toBeNull();
  });

  it("refuses a malformed nonce, timestamp or signature header", () => {
    const request = signed("s1", "/kakaotalk/webhook", webhookBody);
    const tamper = (name: string, value: string) => {
      const headers = new Headers(request.headers);
      headers.set(name, value);
      return { ...request, headers };
    };
    expect(verifyRelaySignature(["s1"], tamper(RELAY_NONCE_HEADER, "short"), 1795662000)).toBeNull();
    expect(verifyRelaySignature(["s1"], tamper(RELAY_TIMESTAMP_HEADER, "1795662000.5"), 1795662000)).toBeNull();
    expect(verifyRelaySignature(["s1"], tamper(RELAY_SIGNATURE_HEADER, "zz"), 1795662000)).toBeNull();
  });

  it("accepts the previous secret while it is configured, and nothing once it is removed (rotation)", () => {
    const old = signed("old-secret", "/kakaotalk/outbox/claim", "{}");
    expect(verifyRelaySignature(kakaotalkConfig({ KAKAOTALK_RELAY_OUTBOX_SECRET: "new", KAKAOTALK_RELAY_OUTBOX_SECRET_PREVIOUS: "old-secret" }).outboxSecrets, old, 1795662000)).toBe(nonce);
    expect(verifyRelaySignature(kakaotalkConfig({ KAKAOTALK_RELAY_OUTBOX_SECRET: "new" }).outboxSecrets, old, 1795662000)).toBeNull();
  });

  it("refuses everything when the route class has no secret", () => {
    const config = kakaotalkConfig({ KAKAOTALK_RELAY_INBOUND_SECRET: "in" });
    expect(config.outboxSecrets).toEqual([]);
    expect(verifyRelaySignature(config.outboxSecrets, signed("", "/kakaotalk/outbox/claim", "{}"), 1795662000)).toBeNull();
  });

  it("offers KakaoTalk only with the account ID and both current relay secrets", () => {
    const full = { KAKAOTALK_ACCOUNT_ID: "findmeatime", KAKAOTALK_RELAY_INBOUND_SECRET: "in", KAKAOTALK_RELAY_OUTBOX_SECRET: "out" };
    expect(kakaotalkAccountIdIfConfigured(full)).toBe("findmeatime");
    expect(kakaotalkAccountIdIfConfigured({ ...full, KAKAOTALK_RELAY_OUTBOX_SECRET: "" })).toBe("");
    expect(kakaotalkAccountIdIfConfigured({ ...full, KAKAOTALK_RELAY_INBOUND_SECRET: undefined, KAKAOTALK_RELAY_INBOUND_SECRET_PREVIOUS: "old" })).toBe("");
    expect(kakaotalkAccountIdIfConfigured({ ...full, KAKAOTALK_ACCOUNT_ID: "" })).toBe("");
  });

  it("is not configured without an account ID, and keeps the two route classes apart", () => {
    expect(kakaotalkConfig({})).toEqual({ accountId: "", inboundSecrets: [], outboxSecrets: [] });
    const config = kakaotalkConfig({ KAKAOTALK_ACCOUNT_ID: " findmeatime ", KAKAOTALK_RELAY_INBOUND_SECRET: "in", KAKAOTALK_RELAY_OUTBOX_SECRET: "out" });
    expect(config).toEqual({ accountId: "findmeatime", inboundSecrets: ["in"], outboxSecrets: ["out"] });
    expect(verifyRelaySignature(config.outboxSecrets, signed("in", "/kakaotalk/outbox/claim", "{}"), 1795662000)).toBeNull();
  });
});

describe("parseKakaoTalkEvent", () => {
  const message = JSON.parse(webhookBody) as Record<string, unknown>;

  it("reads a 1:1 message as a receipt keyed by its event ID, with the sender's name", () => {
    const event = parseKakaoTalkEvent(message);
    expect(event?.kind).toBe("message");
    if (event?.kind !== "message") return;
    expect(event.message).toEqual({
      channel: "kakaotalk",
      contentType: "text",
      kakaotalk: { displayName: "Test Host" },
      messageId: "kakaotalk:486083133936417:1795662000123:0",
      sender: "486083133936417",
      sentAt: new Date("2026-11-26T03:00:00.123Z"),
      spaceId: "486083133936417",
      spaceType: "dm",
      text: "hello",
    });
  });

  it("gives two messages of one notification two IDs and two payload hashes", () => {
    const first = parseKakaoTalkEvent(message);
    const second = parseKakaoTalkEvent({ ...message, eventId: "486083133936417:1795662000123:1", text: "and another" });
    expect(first?.kind === "message" && second?.kind === "message" && first.message.messageId !== second.message.messageId).toBe(true);
    expect(first?.kind === "message" && second?.kind === "message" && first.payloadSha256 !== second.payloadSha256).toBe(true);
  });

  it("hashes the same message the same whatever its key order, and a changed text differently", () => {
    const reordered = Object.fromEntries(Object.entries(message).reverse());
    const hash = (value: unknown) => {
      const event = parseKakaoTalkEvent(value);
      return event?.kind === "message" ? event.payloadSha256 : null;
    };
    expect(hash(reordered)).toBe(hash(message));
    expect(hash({ ...message, text: "changed" })).not.toBe(hash(message));
  });

  it("reads a photo or file as a non-text message with no text", () => {
    const event = parseKakaoTalkEvent({ ...message, nonText: true, text: "사진" });
    expect(event?.kind === "message" && [event.message.contentType, event.message.text]).toEqual(["attachment", null]);
  });

  it("stores nothing from a group or open chat", () => {
    expect(parseKakaoTalkEvent({ ...message, isGroup: true })).toEqual({ kind: "group" });
    expect(parseKakaoTalkEvent({ ...message, isOpenChat: true })).toEqual({ kind: "group" });
  });

  it("reads void_code as the code's hash only", () => {
    const codeHash = kakaotalkCodeHash("test-inbound-secret", "FMAT-7K3Q9M2XWA");
    expect(parseKakaoTalkEvent({ codeHash, eventId: "void:486083133936417:1795662000123:0:0", kind: "void_code" })).toEqual({ codeHash, kind: "void_code" });
    expect(parseKakaoTalkEvent({ codeHash: "FMAT-7K3Q9M2XWA", kind: "void_code" })).toBeNull();
  });

  it("refuses an event whose ID does not name its room, or that has no text", () => {
    expect(parseKakaoTalkEvent({ ...message, eventId: "999:1795662000123:0" })).toBeNull();
    expect(parseKakaoTalkEvent({ ...message, roomId: "room-1", eventId: "room-1:1:0" })).toBeNull();
    expect(parseKakaoTalkEvent({ ...message, text: "" })).toBeNull();
    expect(parseKakaoTalkEvent({ ...message, isGroup: undefined })).toBeNull();
    expect(parseKakaoTalkEvent({ ...message, kind: "other" })).toBeNull();
    expect(parseKakaoTalkEvent(null)).toBeNull();
  });

  it("takes the display name from the notification's sender only, without control characters", () => {
    const event = parseKakaoTalkEvent({ ...message, senderName: "  도현\u0000\n  ", text: "My name is Mallory" });
    expect(event?.kind === "message" && event.message.kakaotalk).toEqual({ displayName: "도현" });
  });
});

describe("void_code hash", () => {
  it("matches the relay app's known answer, under the current or previous secret", () => {
    const hash = "2a6f0e5c45fef716cd8c61d3ebfce454cb918bd2a0fccf178aa204356fa23fa2";
    expect(kakaotalkCodeHash("test-inbound-secret", "fmat-7k3q9m2xwa")).toBe(hash);
    expect(codeHashMatches(["new", "test-inbound-secret"], "FMAT-7K3Q9M2XWA", hash)).toBe(true);
    expect(codeHashMatches(["new"], "FMAT-7K3Q9M2XWA", hash)).toBe(false);
  });
});

describe("KakaoTalk sender identity", () => {
  it("hashes a room ID in its own namespace, apart from the same value on Telegram or iMessage", () => {
    const key = { id: "k1", key: Buffer.alloc(32, 7) };
    const kakaotalk = channelHash(key, "kakaotalk", "sender", "486083133936417");
    expect(kakaotalk).not.toBe(channelHash(key, "telegram", "sender", "486083133936417"));
    expect(kakaotalk).not.toBe(channelHash(key, "imessage", "sender", "486083133936417"));
  });

  it("seals the text with the sender's name and opens it again", () => {
    const sealed = sealedKakaoTalkText("hello", { displayName: "Test Host" });
    expect(openKakaoTalkText(sealed)).toEqual({ details: { displayName: "Test Host" }, text: "hello" });
    expect(openKakaoTalkText("not json")).toBeNull();
  });

  it("nudges with the fixed text that names no request, person, time or place", () => {
    expect(KAKAOTALK_NUDGE_TEXT).toBe("Find Me a Time에 새 소식이 있어요. 아무 말이나 답장해 주시면 바로 보내드릴게요.");
  });
});
