import { randomBytes } from "node:crypto";
import type { Database } from "../../../lib/server/database";
import { kakaotalkCodeHash, kakaotalkConfig, relayHeaders } from "../../../lib/server/kakaotalk";
import { type KakaoTalkOutboxDependencies, receiveKakaoTalkClaim, receiveKakaoTalkHeartbeat, receiveKakaoTalkResult } from "../../../lib/server/kakaotalk-outbox";
import { receiveKakaoTalkWebhook } from "../../../lib/server/kakaotalk-receiver";
import { channelHash } from "../../../lib/server/photon-receiver";
import { testTokenKey } from "./requests";

// The KakaoTalk relay phone's stand-in (host-kakaotalk-channel task 2.4): it
// plays the Android relay app against the real routes, signed as the app signs
// (apps/kakaotalk-relay/PROTOCOL.md), on a loopback origin, the only one a
// local run admits. It keeps the rooms whose notification is posted, as the
// phone's notification shade does: a host's message posts their room, and a
// reply through that notification's action clears it.

export const TEST_KAKAOTALK_ID = "findmeatime_test";
export const RELAY_INBOUND_SECRET = "kakaotalk-test-inbound-secret";
export const RELAY_OUTBOX_SECRET = "kakaotalk-test-outbox-secret";
const ORIGIN = "http://127.0.0.1:2999";

let lastRoom = Date.now() * 1000;

export function newKakaoTalkRoom() {
  lastRoom += 1;
  return String(lastRoom);
}

export type ClaimAnswer = {
  readonly id: string;
  readonly leaseToken: string;
  readonly mode: "reply" | "nudge";
  readonly roomId: string;
  readonly displayName: string | null;
  readonly text: string;
};

export function kakaotalkRelay(db: Database, env: Record<string, string | undefined> = {}) {
  const deps = (): KakaoTalkOutboxDependencies => ({
    claimWaitMs: 0,
    config: kakaotalkConfig({ KAKAOTALK_ACCOUNT_ID: TEST_KAKAOTALK_ID, KAKAOTALK_RELAY_INBOUND_SECRET: RELAY_INBOUND_SECRET, KAKAOTALK_RELAY_OUTBOX_SECRET: RELAY_OUTBOX_SECRET, ...env }),
    db,
    env: {},
    origin: "http://localhost:3000",
    pollMs: 0,
    tokenKey: testTokenKey,
    tokenKeys: [testTokenKey],
  });
  const posted = new Set<string>();
  const counters = new Map<string, number>();

  function signed(path: string, body: string, secret: string, nonce = randomBytes(16).toString("hex")) {
    return new Request(`${ORIGIN}${path}`, { body, headers: relayHeaders(secret, "POST", path, body, Math.floor(Date.now() / 1000), nonce), method: "POST" });
  }

  return {
    deps,
    posted,
    signed,
    hash: (roomId: string) => channelHash(testTokenKey, "kakaotalk", "sender", roomId),
    // Ends what earlier tests left open for the relay, so each test sees only its own chats.
    async quiet() {
      posted.clear();
      await db`
        update app.imessage_outbox
        set state = case when state = 'dispatching' then 'uncertain' else 'suppressed' end, failure_category = 'test_reset',
            lease_token_hash = null, lease_expires_at = null, recipient_ciphertext = null, text_ciphertext = null,
            completed_at = now(), updated_at = now()
        where channel = 'kakaotalk' and state in ('waiting', 'queued', 'dispatching')
      `;
    },
    // One message event as the listener reads it from a 1:1 notification.
    message(roomId: string, text: string | null, options: { readonly senderName?: string; readonly nonText?: boolean; readonly at?: number } = {}) {
      const at = options.at ?? Date.now();
      const index = counters.get(`${roomId}:${at}`) ?? 0;
      counters.set(`${roomId}:${at}`, index + 1);
      return {
        eventId: `${roomId}:${at}:${index}`,
        isGroup: false,
        postedAt: new Date(at).toISOString(),
        roomId,
        senderName: options.senderName ?? "Test Host",
        text,
        ...(options.nonText ? { nonText: true } : {}),
      };
    },
    voidCode: (code: string) => ({ codeHash: kakaotalkCodeHash(RELAY_INBOUND_SECRET, code), eventId: `void:${Date.now()}:0`, kind: "void_code" }),
    // Posts an event to the webhook; a 1:1 message posts its room's notification.
    async post(event: Record<string, unknown>, nonce?: string) {
      const response = await receiveKakaoTalkWebhook(signed("/kakaotalk/webhook", JSON.stringify(event), RELAY_INBOUND_SECRET, nonce), deps);
      if (response.status === 200 && event.isGroup === false && typeof event.roomId === "string") posted.add(event.roomId);
      return response;
    },
    async heartbeat(beat: { readonly listenerEnabled?: boolean; readonly accessibilityEnabled?: boolean; readonly locked?: boolean } = {}) {
      const body = JSON.stringify({
        accessibilityEnabled: beat.accessibilityEnabled ?? true,
        kakaoVersion: "26.10.1",
        listenerEnabled: beat.listenerEnabled ?? true,
        locked: beat.locked ?? false,
        postedRooms: [...posted].sort(),
      });
      const response = await receiveKakaoTalkHeartbeat(signed("/kakaotalk/heartbeat", body, RELAY_OUTBOX_SECRET), deps);
      return { body: (await response.json()) as { status: string; cause?: string }, status: response.status };
    },
    // One claim; null for 204.
    async claim(options: { readonly locked?: boolean; readonly rooms?: readonly string[]; readonly replyable?: readonly string[] } = {}): Promise<ClaimAnswer | null> {
      const body = JSON.stringify({
        locked: options.locked ?? false,
        postedRooms: [...(options.rooms ?? posted)].sort(),
        ...(options.replyable ? { replyableRooms: [...options.replyable].sort() } : {}),
      });
      const response = await receiveKakaoTalkClaim(signed("/kakaotalk/outbox/claim", body, RELAY_OUTBOX_SECRET), deps);
      if (response.status === 204) return null;
      if (response.status !== 200) throw new Error(`The claim answered ${response.status}.`);
      return (await response.json()) as ClaimAnswer;
    },
    async report(id: string, leaseToken: string, outcome: "accepted" | "failed" | "uncertain" | "not_started") {
      const response = await receiveKakaoTalkResult(
        signed(`/kakaotalk/outbox/${id}/result`, JSON.stringify({ leaseToken, outcome }), RELAY_OUTBOX_SECRET),
        id,
        deps,
      );
      return { body: (await response.json().catch(() => null)) as { state: string } | null, status: response.status };
    },
    // Sends a claimed reply as the reply action does: the notification goes away.
    async replied(claim: ClaimAnswer) {
      const result = await this.report(claim.id, claim.leaseToken, "accepted");
      if (claim.mode === "reply") posted.delete(claim.roomId);
      return result;
    },
  };
}
