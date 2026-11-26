import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { relayHeaders } from "../../lib/server/kakaotalk";
import { testDatabase } from "./support/database";
import { type EveServer, startEve } from "./support/eve-server";
import { type FakeOpenAI, startFakeOpenAI } from "./support/fake-openai";

// The KakaoTalk relay routes through the real eve router (`eve dev`), as the
// relay phone reaches them (host-kakaotalk-channel design 2): the path the
// relay signs is the path the route sees, so a signed heartbeat is recorded,
// the same signature replayed is refused, and one signed for another route or
// with no secret configured is refused.

const db = testDatabase();
const OUTBOX_SECRET = `eve-route-outbox-${randomBytes(8).toString("hex")}`;
let fake: FakeOpenAI;
let server: EveServer;

beforeAll(async () => {
  fake = await startFakeOpenAI();
  server = await startEve("dev", {
    env: { KAKAOTALK_RELAY_INBOUND_SECRET: `eve-route-inbound-${randomBytes(8).toString("hex")}`, KAKAOTALK_RELAY_OUTBOX_SECRET: OUTBOX_SECRET },
    modelBaseURL: fake.baseURL,
  });
}, 400_000);

afterAll(async () => {
  await server?.stop();
  await fake.close();
  await db`delete from app.kakaotalk_relay_heartbeats`;
  await db.end();
});

function heartbeat(path: string, body: string, nonce = randomBytes(16).toString("hex")) {
  return { body, headers: relayHeaders(OUTBOX_SECRET, "POST", path, body, Math.floor(Date.now() / 1000), nonce), method: "POST" };
}

describe("KakaoTalk relay routes through the eve router", () => {
  it("records a signed heartbeat and refuses its replay", async () => {
    await db`delete from app.kakaotalk_relay_heartbeats`;
    const body = JSON.stringify({ accessibilityEnabled: true, kakaoVersion: "26.10.1", listenerEnabled: true, locked: false, postedRooms: ["486083133936417"] });
    const signed = heartbeat("/kakaotalk/heartbeat", body);

    const response = await fetch(`${server.url}/kakaotalk/heartbeat`, signed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "up" });
    const [row] = await db<{ kakaotalk_version: string; posted_rooms: number }[]>`select kakaotalk_version, posted_rooms from app.kakaotalk_relay_heartbeats`;
    expect(row).toEqual({ kakaotalk_version: "26.10.1", posted_rooms: 1 });

    expect((await fetch(`${server.url}/kakaotalk/heartbeat`, signed)).status).toBe(401);
  });

  it("refuses a heartbeat signed for another path, and the webhook signed with the outbox secret", async () => {
    const body = JSON.stringify({ accessibilityEnabled: true, listenerEnabled: true, locked: false });
    expect((await fetch(`${server.url}/kakaotalk/heartbeat`, heartbeat("/kakaotalk/outbox/claim", body))).status).toBe(401);
    expect((await fetch(`${server.url}/kakaotalk/webhook`, heartbeat("/kakaotalk/webhook", "{}"))).status).toBe(401);
  });
});
