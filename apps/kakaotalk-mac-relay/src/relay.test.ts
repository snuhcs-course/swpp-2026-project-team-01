import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileStore, helperUi, kakaocliQuery, sendAttemptOf } from "./adapters.ts";
import { leaveRoom, sendToRoom } from "./delivery.ts";
import { MacRelay, type HttpAnswer, type RelayState } from "./relay.ts";
import { FakeKakao, FakeMessenger, FakeUi, RECORDED } from "./testing.ts";

// Sending, leaving and the relay loops (host-kakaotalk-mac-relay designs 3 to
// 8) against the recorded database rows, the recorded chat-list labels and a
// fake kakaocli, and the adapters against kakaocli's and the helper's output.

const quick = { landingMs: 2, landingStepMs: 1, sleep: async () => {} };

function delivery(kakao = new FakeKakao()) {
  const ui = new FakeUi(kakao, RECORDED.rows().names);
  const messenger = new FakeMessenger(kakao);
  return { deps: { ...quick, db: kakao, messenger, myUserId: kakao.account, ui }, kakao, messenger, ui };
}

describe("sending", () => {
  it("accepts a reply that lands in the expected room", async () => {
    const { deps, messenger } = delivery();
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "accepted" });
    expect(messenger.sent).toEqual([{ chatId: RECORDED.hostRoom, name: "Test Host", text: "답장" }]);
  });

  it("reports wrong_room when the text shows up in another room", async () => {
    const { deps, messenger } = delivery();
    messenger.into = RECORDED.group;
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "uncertain", reason: "wrong_room" });
  });

  it("is uncertain when the text never appears", async () => {
    const { deps, messenger } = delivery();
    messenger.land = false;
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "uncertain" });
    expect((await sendToRoom(deps, RECORDED.hostRoom, "답장")).reason).toBeUndefined();
  });

  it("sends nothing when the chat list shows the name twice or not exactly", async () => {
    const { deps, messenger, ui } = delivery();
    ui.labels = ["Test Host", "Test Host (2)"];
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "failed" });
    ui.labels = ["test host"];
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "failed" });
    ui.unavailable = true;
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "not_started" });
    expect(messenger.sent).toEqual([]);
  });

  it("sends nothing to a room another room's name contains, or to a friend who never wrote", async () => {
    const { deps, kakao, messenger } = delivery();
    kakao.addRoom({ chatId: "200", directMemberUserId: "7", memberNames: ["Test Host Kim"], memberWrote: true });
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ detail: "room not sendable", outcome: "failed" });
    kakao.addRoom({ chatId: "300", directMemberUserId: "8", memberNames: ["Quiet Friend"] });
    expect(await sendToRoom(deps, "300", "안녕하세요")).toMatchObject({ outcome: "failed" });
    expect(messenger.sent).toEqual([]);
  });

  it("is uncertain, never a retry, when the database read after sending fails", async () => {
    const { deps, kakao } = delivery();
    kakao.failOwnReads = true;
    expect(await sendToRoom(deps, RECORDED.hostRoom, "답장")).toMatchObject({ outcome: "uncertain" });
  });

  it("maps kakaocli's failures by whether anything was typed", async () => {
    const { deps, messenger } = delivery();
    messenger.attempt = { detail: "chat not found", status: "chat_not_found" };
    expect((await sendToRoom(deps, RECORDED.hostRoom, "a")).outcome).toBe("failed");
    messenger.attempt = { detail: "no window", status: "not_started" };
    expect((await sendToRoom(deps, RECORDED.hostRoom, "b")).outcome).toBe("not_started");
    // A crash after typing: the landing check decides.
    messenger.attempt = { detail: "exit 134", status: "error" };
    expect((await sendToRoom(deps, RECORDED.hostRoom, "c")).outcome).toBe("accepted");
    messenger.land = false;
    expect((await sendToRoom(deps, RECORDED.hostRoom, "d")).outcome).toBe("uncertain");
  });
});

describe("leaving", () => {
  it("accepts once the room is gone from the database", async () => {
    const { deps, ui } = delivery();
    expect(await leaveRoom(deps, RECORDED.group)).toMatchObject({ outcome: "accepted" });
    expect(ui.left).toEqual(["테스트 그룹"]);
    // Already gone.
    expect(await leaveRoom(deps, RECORDED.group)).toMatchObject({ detail: "not a member", outcome: "accepted" });
  });

  it("tries again later when nothing was pressed or the room is still there", async () => {
    const { deps, ui } = delivery();
    ui.leaveStage = "no_menu";
    expect((await leaveRoom(deps, RECORDED.group)).outcome).toBe("not_started");
    ui.leaveStage = "no_confirm";
    expect((await leaveRoom(deps, RECORDED.group)).outcome).toBe("not_started");
    ui.leaveStage = "not_found";
    expect((await leaveRoom(deps, RECORDED.group)).outcome).toBe("failed");
  });

  it("fails for good when another room disappears instead", async () => {
    const { deps, kakao, ui } = delivery();
    kakao.addRoom({ chatId: "400", chatName: "다른 그룹", kind: "group" });
    ui.leaveInstead = "400";
    expect(await leaveRoom(deps, RECORDED.group)).toMatchObject({ detail: "another room disappeared", outcome: "failed" });
  });

  it("never leaves an untitled group by name", async () => {
    const { deps, kakao, ui } = delivery();
    kakao.addRoom({ chatId: "401", kind: "group", memberNames: ["Kim", "Park"] });
    expect((await leaveRoom(deps, "401")).outcome).toBe("failed");
    expect(ui.left).toEqual([]);
  });

  it("never leaves a 1:1 room", async () => {
    const { deps, ui } = delivery();
    expect((await leaveRoom(deps, RECORDED.hostRoom)).detail).toBe("not a member");
    expect(ui.left).toEqual([]);
  });
});

type Sent = { readonly path: string; readonly body: Record<string, unknown>; readonly secret: string };

function relay(answers: (sent: Sent) => HttpAnswer = () => ({ body: null, status: 200 }), kakao = new FakeKakao()) {
  const sent: Sent[] = [];
  let saved: RelayState | null = null;
  let now = 1795700000000;
  const ui = new FakeUi(kakao, null);
  const messenger = new FakeMessenger(kakao);
  const instance = new MacRelay({
    ...quick,
    config: { groupEvents: false, inboundSecret: "in", outboxSecret: "out" },
    db: kakao,
    messenger,
    now: () => now,
    post: async (path, body, secret) => {
      const entry = { body: JSON.parse(body) as Record<string, unknown>, path, secret };
      sent.push(entry);
      return answers(entry);
    },
    store: { load: async () => saved, save: async (state) => void (saved = state) },
    ui,
  });
  return { advance: (ms: number) => void (now += ms), instance, kakao, messenger, saved: () => saved, sent, ui };
}

describe("watcher", () => {
  it("replays no history on the first start and forwards the host's next message", async () => {
    const { instance, kakao, sent } = relay();
    await instance.start();
    expect(await instance.watchOnce()).toBe(0);
    kakao.add(RECORDED.hostRoom, RECORDED.host, "다음 주 화요일 가능해요?");
    kakao.add(RECORDED.hostRoom, RECORDED.account, "own reply");
    expect(await instance.watchOnce()).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ body: { relay: "mac", roomId: RECORDED.hostRoom, text: "다음 주 화요일 가능해요?" }, path: "/kakaotalk/webhook", secret: "in" });
    expect(await instance.watchOnce()).toBe(0);
  });

  it("keeps the mark until the service answers, and drops a final refusal", async () => {
    let status = 503;
    const { instance, kakao, saved, sent } = relay(() => ({ body: null, status }));
    await instance.start();
    const first = kakao.add(RECORDED.hostRoom, RECORDED.host, "one");
    kakao.add(RECORDED.hostRoom, RECORDED.host, "two");
    await instance.watchOnce();
    expect(sent.map((entry) => entry.body.text)).toEqual(["one"]);
    expect(saved()!.marks[RECORDED.hostRoom]).not.toBe(first.logId);
    status = 409;
    await instance.watchOnce();
    expect(sent.map((entry) => entry.body.text)).toEqual(["one", "one", "two"]);
    expect(await instance.watchOnce()).toBe(0);
  });

  it("resumes from the saved marks after a restart", async () => {
    const first = relay();
    await first.instance.start();
    first.kakao.add(RECORDED.hostRoom, RECORDED.host, "before restart");
    await first.instance.watchOnce();
    const state = first.saved();
    first.kakao.add(RECORDED.hostRoom, RECORDED.host, "after restart");

    const sent: string[] = [];
    const second = new MacRelay({
      ...quick,
      config: { groupEvents: false, inboundSecret: "in", outboxSecret: "out" },
      db: first.kakao,
      messenger: new FakeMessenger(first.kakao),
      now: Date.now,
      post: async (_path, body) => {
        sent.push(JSON.parse(body).text as string);
        return { body: null, status: 200 };
      },
      store: { load: async () => state, save: async () => {} },
      ui: new FakeUi(first.kakao),
    });
    await second.start();
    await second.watchOnce();
    expect(sent).toEqual(["after restart"]);
  });

  it("reads a room first seen after the start from the start time, so a first code message arrives", async () => {
    const { instance, kakao, sent } = relay();
    await instance.start();
    kakao.addRoom({ chatId: "555", directMemberUserId: "77", lastLogId: "0", memberNames: ["New Host"] });
    kakao.add("555", "77", "FMAT-7K3Q9M2XWA", 1, 1795700001);
    await instance.watchOnce();
    expect(sent.map((entry) => entry.body.text)).toEqual(["FMAT-7K3Q9M2XWA"]);
  });
});

describe("claims and heartbeat", () => {
  it("claims with the sendable and member rooms, sends, and reports accepted", async () => {
    const { instance, kakao, messenger, sent } = relay((entry) =>
      entry.path === "/kakaotalk/outbox/claim"
        ? { body: { id: "m1", leaseToken: "token-0123456789abcdef", mode: "reply", roomId: RECORDED.hostRoom, text: "회의 요약" }, status: 200 }
        : { body: { state: "accepted" }, status: 200 },
    );
    await instance.start();
    const result = await instance.claimOnce();
    expect(result).toMatchObject({ outcome: { outcome: "accepted" }, status: "done" });
    expect(sent[0]).toMatchObject({ body: { memberRooms: [RECORDED.group], postedRooms: [], relay: "mac", replyableRooms: [RECORDED.hostRoom] }, secret: "out" });
    expect(sent[1]).toMatchObject({ body: { leaseToken: "token-0123456789abcdef", outcome: "accepted" }, path: "/kakaotalk/outbox/m1/result" });
    expect(messenger.sent.map((entry) => entry.text)).toEqual(["회의 요약"]);
    expect(kakao.messages_.at(-1)).toMatchObject({ chatId: RECORDED.hostRoom, text: "회의 요약" });
  });

  it("reports the wrong_room reason", async () => {
    const { instance, messenger, sent } = relay((entry) =>
      entry.path === "/kakaotalk/outbox/claim"
        ? { body: { id: "m2", leaseToken: "token-0123456789abcdef", mode: "reply", roomId: RECORDED.hostRoom, text: "요약" }, status: 200 }
        : { body: null, status: 200 },
    );
    messenger.into = RECORDED.group;
    await instance.start();
    await instance.claimOnce();
    expect(sent[1]!.body).toEqual({ leaseToken: "token-0123456789abcdef", outcome: "uncertain", reason: "wrong_room", relay: "mac" });
  });

  it("refuses a nudge, and does not claim while the screen is locked", async () => {
    const { instance, messenger, sent, ui } = relay((entry) =>
      entry.path === "/kakaotalk/outbox/claim"
        ? { body: { displayName: "Test Host", id: "n1", leaseToken: "token-0123456789abcdef", mode: "nudge", text: "nudge" }, status: 200 }
        : { body: null, status: 200 },
    );
    await instance.start();
    await instance.claimOnce();
    expect(sent[1]!.body.outcome).toBe("failed");
    expect(messenger.sent).toEqual([]);
    ui.probed = { ...ui.probed, locked: true };
    expect(await instance.claimOnce()).toEqual({ status: "locked" });
    expect(sent).toHaveLength(2);
  });

  it("retries a result on 5xx and stops at a 4xx", async () => {
    let results = 0;
    const { instance } = relay((entry) => {
      if (entry.path === "/kakaotalk/outbox/claim") return { body: { id: "m3", leaseToken: "token-0123456789abcdef", mode: "leave", roomId: RECORDED.group }, status: 200 };
      results += 1;
      return { body: null, status: results < 3 ? 503 : 409 };
    });
    await instance.start();
    expect(await instance.claimOnce()).toMatchObject({ outcome: { outcome: "accepted" } });
    expect(results).toBe(3);
  });

  it("reads idle and standby answers", async () => {
    let status = 204;
    const { instance } = relay(() => ({ body: status === 409 ? { status: "standby" } : null, status }));
    await instance.start();
    expect(await instance.claimOnce()).toEqual({ status: "idle" });
    status = 409;
    expect(await instance.claimOnce()).toEqual({ status: "standby" });
    status = 500;
    expect(await instance.claimOnce()).toEqual({ status: "error" });
  });

  it("beats with the Mac's meanings of the phone's fields", async () => {
    const { advance, instance, sent, ui } = relay();
    await instance.start();
    await instance.beatOnce();
    expect(sent[0]).toMatchObject({
      body: { accessibilityEnabled: true, kakaoVersion: "26.10.0", listenerEnabled: true, locked: false, postedRooms: [], relay: "mac", replyableRooms: [RECORDED.hostRoom] },
      path: "/kakaotalk/heartbeat",
      secret: "out",
    });
    ui.probed = { ...ui.probed, kakaoRunning: false, trusted: false };
    advance(1000);
    await instance.beatOnce();
    expect(sent[1]!.body).toMatchObject({ accessibilityEnabled: false, listenerEnabled: false });
  });
});

describe("adapters", () => {
  it("maps kakaocli send's output to whether anything was typed", () => {
    const done = { code: 0, stderr: "", stdout: "Message sent to 'Test Host'.", timedOut: false };
    expect(sendAttemptOf(done)).toEqual({ status: "sent" });
    expect(sendAttemptOf({ ...done, code: 1, stderr: "Error: Chat 'Test Host' not found in the chat list" }).status).toBe("chat_not_found");
    expect(sendAttemptOf({ ...done, code: 1, stderr: "Error: KakaoTalk has no open windows" }).status).toBe("not_started");
    expect(sendAttemptOf({ ...done, code: 1, stderr: "Error: Could not find the message input field" }).status).toBe("not_started");
    expect(sendAttemptOf({ ...done, code: 1, stderr: "", timedOut: true }).status).toBe("error");
    expect(sendAttemptOf({ ...done, code: 134, stderr: "Trace/BPT trap" }).status).toBe("error");
    expect(sendAttemptOf({ ...done, code: 1, stderr: "Error: KakaoTalk is showing the login screen but no credentials are stored." }).status).toBe("not_started");
    // A failure that only mentions KakaoTalk and an update may come after typing.
    expect(sendAttemptOf({ ...done, code: 1, stderr: "KakaoTalk update check failed after send" }).status).toBe("error");
  });

  it("passes the key and SQL to kakaocli query and parses its rows", async () => {
    const calls: (readonly string[])[] = [];
    const runner = kakaocliQuery("/bin/kakaocli", "secret-key", null, async (_file, args) => {
      calls.push(args);
      return { code: 0, stderr: "", stdout: JSON.stringify(RECORDED.rooms()), timedOut: false };
    });
    expect(await runner.query("SELECT 1")).toHaveLength(3);
    expect(calls[0]).toEqual(["query", "--key", "secret-key", "SELECT 1"]);
    const failing = kakaocliQuery("/bin/kakaocli", "k", "/db", async () => ({ code: 1, stderr: "PRAGMA key failed", stdout: "", timedOut: false }));
    await expect(failing.query("SELECT 1")).rejects.toThrow("exit 1");
  });

  it("reads the helper's recorded answers, and counts an unreadable probe as locked", async () => {
    const answers: Record<string, string> = {
      leave: '{"detail":"pressed","stage":"pressed"}',
      probe: '{"kakaoRunning":true,"kakaoVersion":"26.10.0","locked":true,"trusted":true}',
      rows: JSON.stringify(RECORDED.rows()),
    };
    const ui = helperUi("/bin/kakao-ax", async (_file, args) => ({ code: 0, stderr: "", stdout: answers[args[0]!] ?? "", timedOut: false }));
    expect(await ui.probe()).toEqual({ kakaoRunning: true, kakaoVersion: "26.10.0", locked: true, trusted: true });
    expect(await ui.chatListNames()).toEqual(["Test Host", "테스트 그룹", "카카오계정"]);
    expect(await ui.leave("테스트 그룹")).toEqual({ detail: "pressed", stage: "pressed" });
    const broken = helperUi("/bin/kakao-ax", async () => ({ code: 2, stderr: "", stdout: '{"available":false,"names":null}', timedOut: false }));
    expect(await broken.chatListNames()).toBeNull();
    expect((await broken.probe()).locked).toBe(true);
  });

  it("writes the state file only for its owner", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "mac-relay-")), "state", "state.json");
    const store = fileStore(path);
    expect(await store.load()).toBeNull();
    await store.save({ marks: { [RECORDED.hostRoom]: "3982372862361772034" }, startedAt: 1795700000 });
    expect(await store.load()).toEqual({ marks: { [RECORDED.hostRoom]: "3982372862361772034" }, startedAt: 1795700000 });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
