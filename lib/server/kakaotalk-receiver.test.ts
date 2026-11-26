import { describe, expect, it } from "vitest";
import type { Database } from "./database";
import { kakaotalkConfig, relayHeaders } from "./kakaotalk";
import { receiveKakaoTalkClaim, receiveKakaoTalkHeartbeat, receiveKakaoTalkResult } from "./kakaotalk-outbox";
import { receiveKakaoTalkWebhook, type RelayDependencies } from "./kakaotalk-receiver";

// The relay routes' checks before any delivery state is read
// (host-kakaotalk-channel design 2, "KakaoTalk messaging only in production"):
// a preview deployment, a missing secret, a wrong signature and an oversized
// body are refused without touching the database. Nonce replays, storing,
// duplicates and the outbox run against the local stack in
// tests/integration/kakaotalk-relay.test.ts.

const untouched = new Proxy(
  {},
  {
    get() {
      throw new Error("The database was touched.");
    },
  },
) as Database;

const production = { VERCEL_ENV: "production", VERCEL: "1", APP_ORIGIN: "https://findmeatime.com" };
const preview = { VERCEL_ENV: "preview", VERCEL: "1" };
const secrets = { KAKAOTALK_RELAY_INBOUND_SECRET: "inbound-secret", KAKAOTALK_RELAY_OUTBOX_SECRET: "outbox-secret" };

const load =
  (env: Record<string, string>, configured: Record<string, string> = secrets) =>
  (): RelayDependencies & { origin: string } => ({
    config: kakaotalkConfig(configured),
    db: untouched,
    env,
    origin: "https://findmeatime.com",
    tokenKey: { id: "k1", key: Buffer.alloc(32, 1) },
    tokenKeys: [{ id: "k1", key: Buffer.alloc(32, 1) }],
  });

function relayRequest(path: string, body: string, secret: string, origin = "https://findmeatime.com") {
  return new Request(`${origin}${path}`, {
    body,
    headers: relayHeaders(secret, "POST", path, body, Math.floor(Date.now() / 1000), "0123456789abcdef0123456789abcdef"),
    method: "POST",
  });
}

const id = "00000000-0000-4000-8000-000000000001";
const result = JSON.stringify({ leaseToken: "x".repeat(43), outcome: "accepted" });
const beat = JSON.stringify({ accessibilityEnabled: true, kakaoVersion: "26.10.1", listenerEnabled: true, locked: false, postedRooms: [] });

describe("KakaoTalk relay routes", () => {
  it("refuse a correctly signed request on a preview deployment before reading anything", async () => {
    expect((await receiveKakaoTalkWebhook(relayRequest("/kakaotalk/webhook", "{}", "inbound-secret"), load(preview))).status).toBe(403);
    expect((await receiveKakaoTalkClaim(relayRequest("/kakaotalk/outbox/claim", "{}", "outbox-secret"), load(preview))).status).toBe(403);
    expect((await receiveKakaoTalkResult(relayRequest(`/kakaotalk/outbox/${id}/result`, result, "outbox-secret"), id, load(preview))).status).toBe(403);
    expect((await receiveKakaoTalkHeartbeat(relayRequest("/kakaotalk/heartbeat", beat, "outbox-secret"), load(preview))).status).toBe(403);
  });

  it("refuse a production deployment whose origin is staging", async () => {
    const staging = { ...production, APP_ORIGIN: "https://staging.findmeatime.com" };
    expect((await receiveKakaoTalkClaim(relayRequest("/kakaotalk/outbox/claim", "{}", "outbox-secret"), load(staging))).status).toBe(403);
  });

  it("answer 401 to every outbox, result and heartbeat request while the outbox secret is missing", async () => {
    const inboundOnly = { KAKAOTALK_RELAY_INBOUND_SECRET: "inbound-secret" };
    expect((await receiveKakaoTalkClaim(relayRequest("/kakaotalk/outbox/claim", "{}", "outbox-secret"), load(production, inboundOnly))).status).toBe(401);
    expect((await receiveKakaoTalkResult(relayRequest(`/kakaotalk/outbox/${id}/result`, result, "outbox-secret"), id, load(production, inboundOnly))).status).toBe(401);
    expect((await receiveKakaoTalkHeartbeat(relayRequest("/kakaotalk/heartbeat", beat, "outbox-secret"), load(production, inboundOnly))).status).toBe(401);
    expect((await receiveKakaoTalkWebhook(relayRequest("/kakaotalk/webhook", "{}", "inbound-secret"), load(production, {}))).status).toBe(401);
  });

  it("answer 401 to a request signed for another route or with the other class's secret", async () => {
    const forWebhook = relayRequest("/kakaotalk/webhook", "{}", "outbox-secret");
    const replayed = new Request("https://findmeatime.com/kakaotalk/outbox/claim", { body: "{}", headers: forWebhook.headers, method: "POST" });
    expect((await receiveKakaoTalkClaim(replayed, load(production))).status).toBe(401);
    expect((await receiveKakaoTalkClaim(relayRequest("/kakaotalk/outbox/claim", "{}", "inbound-secret"), load(production))).status).toBe(401);
    expect((await receiveKakaoTalkWebhook(relayRequest("/kakaotalk/webhook", "{}", "outbox-secret"), load(production))).status).toBe(401);
  });

  it("answer 413 to a body over 64 KB", async () => {
    const body = JSON.stringify({ pad: "x".repeat(70 * 1024) });
    expect((await receiveKakaoTalkWebhook(relayRequest("/kakaotalk/webhook", body, "inbound-secret"), load(production))).status).toBe(413);
  });
});
