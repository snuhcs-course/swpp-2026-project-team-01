import { type DeliveryDeps, leaveRoom, type Messenger, type Outcome, sendToRoom, type Ui } from "./delivery.ts";
import { eventsFor } from "./events.ts";
import { type DbMessage, type KakaoReader, logIdAfter, type Room } from "./kakao-db.ts";
import { memberRooms, sendableGroupRooms, sendableRooms, sortedIds } from "./rooms.ts";
import { signedHeaders } from "./signer.ts";

// The Mac relay's three loops (host-kakaotalk-mac-relay designs 3 to 8), on
// PR #501's routes and signing (apps/kakaotalk-relay/PROTOCOL.md):
//   watch      every 2 s, read the rooms whose last log ID moved past the
//              room's mark, post one event per new message in log order, and
//              move the mark only past messages the service answered 2xx or
//              refused for good (400, 409, 413, 422). Marks are saved after
//              each move, so a restart resends at most the unanswered tail.
//   claim      long-poll /kakaotalk/outbox/claim with the sendable 1:1 rooms
//              and the group rooms, carry out the claim and report it; never
//              while the screen is locked.
//   heartbeat  every 60 s.
// No message text is kept: the state holds only room marks and the start time.

export type RelayState = {
  // When the relay first started, in Unix seconds: a room seen later is read from then.
  readonly startedAt: number;
  // The last handled log ID of each room.
  readonly marks: Readonly<Record<string, string>>;
};

export interface StateStore {
  load(): Promise<RelayState | null>;
  save(state: RelayState): Promise<void>;
}

export type HttpAnswer = { readonly status: number; readonly body: unknown };
export type Post = (path: string, body: string, secret: string) => Promise<HttpAnswer>;

export type RelayConfig = {
  readonly inboundSecret: string;
  readonly outboxSecret: string;
  readonly groupEvents: boolean;
  // Members' group text (kakaotalk-group-conversations), on unless set false.
  readonly groupMessages?: boolean;
};

export type RelayDeps = {
  readonly db: KakaoReader;
  readonly ui: Ui;
  readonly messenger: Messenger;
  readonly store: StateStore;
  readonly post: Post;
  readonly config: RelayConfig;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log?: (message: string, fields?: Record<string, unknown>) => void;
  readonly landingMs?: number;
  readonly landingStepMs?: number;
};

// How the phone app reads webhook answers (PROTOCOL.md "Answers the relay expects").
const FINAL_REFUSALS = new Set([400, 409, 413, 422]);

// A signed POST to the service with fetch; any network error is status 0.
export function fetchPost(origin: string, fetcher: typeof fetch = fetch, now: () => number = Date.now, timeoutMs = 40_000): Post {
  const base = origin.replace(/\/+$/, "");
  const prefix = new URL(base).pathname.replace(/\/+$/, "");
  return async (path, body, secret) => {
    try {
      const response = await fetcher(`${base}${path}`, {
        body,
        headers: signedHeaders(secret, `${prefix}${path}`, body, now()),
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { body: parsed, status: response.status };
    } catch {
      return { body: null, status: 0 };
    }
  };
}

type Claim = { readonly id: string; readonly leaseToken: string; readonly mode?: string; readonly roomId?: string; readonly text?: string };

function isClaim(body: unknown): body is Claim {
  if (!body || typeof body !== "object") return false;
  const claim = body as Record<string, unknown>;
  return typeof claim.id === "string" && typeof claim.leaseToken === "string";
}

export class MacRelay {
  readonly #deps: RelayDeps;
  #state: RelayState | null = null;
  #myUserId = "";
  #lastReadAt = 0;
  #users: ReadonlyMap<string, readonly string[]> = new Map();

  constructor(deps: RelayDeps) {
    this.#deps = deps;
  }

  #log(message: string, fields?: Record<string, unknown>) {
    this.#deps.log?.(message, fields);
  }

  // Loads the marks, or on the first start marks every room at its last log ID.
  async start() {
    this.#myUserId = await this.#deps.db.myUserId();
    this.#state = await this.#deps.store.load();
    if (!this.#state) {
      const rooms = await this.#deps.db.rooms();
      this.#state = { marks: Object.fromEntries(rooms.map((room) => [room.chatId, room.lastLogId])), startedAt: Math.floor(this.#deps.now() / 1000) };
      await this.#deps.store.save(this.#state);
    }
    this.#lastReadAt = this.#deps.now();
  }

  get state() {
    return this.#state;
  }

  async #setMark(chatId: string, logId: string) {
    const state = this.#state!;
    this.#state = { ...state, marks: { ...state.marks, [chatId]: logId } };
    await this.#deps.store.save(this.#state);
  }

  // One pass of the watcher; the number of events the service took.
  async watchOnce() {
    const state = this.#state;
    if (!state) throw new Error("start() first");
    const rooms = await this.#deps.db.rooms();
    const users = await this.#deps.db.users();
    this.#users = users;
    this.#lastReadAt = this.#deps.now();
    let posted = 0;

    for (const room of rooms) {
      const mark = state.marks[room.chatId];
      if (mark !== undefined && !logIdAfter(room.lastLogId, mark)) continue;
      const messages: DbMessage[] =
        mark === undefined ? await this.#deps.db.messagesSince(room.chatId, state.startedAt) : await this.#deps.db.messagesAfter(room.chatId, mark);
      for (const message of messages) {
        const delivered = await this.#deliver(message, room);
        if (delivered === "retry") break;
        posted += delivered;
        await this.#setMark(room.chatId, message.logId);
      }
      // A new room with nothing new still gets its mark, so the next pass reads it by log ID.
      if (mark === undefined && messages.length === 0) await this.#setMark(room.chatId, room.lastLogId);
    }
    return posted;
  }

  // Posts a message's events; "retry" when the service should be asked again later.
  async #deliver(message: DbMessage, room: Room): Promise<number | "retry"> {
    const events = eventsFor(message, room, {
      groupEvents: this.#deps.config.groupEvents,
      groupMessages: this.#deps.config.groupMessages !== false,
      inboundSecret: this.#deps.config.inboundSecret,
      myUserId: this.#myUserId,
      namesOf: (userId) => this.#users.get(userId) ?? [],
    });
    let taken = 0;
    for (const event of events) {
      const answer = await this.#deps.post("/kakaotalk/webhook", JSON.stringify(event), this.#deps.config.inboundSecret);
      if (answer.status >= 200 && answer.status < 300) {
        taken += 1;
      } else if (FINAL_REFUSALS.has(answer.status)) {
        this.#log("webhook refused an event", { eventId: event.eventId, status: answer.status });
      } else {
        this.#log("webhook unavailable", { status: answer.status });
        return "retry";
      }
    }
    return taken;
  }

  async #rooms() {
    const rooms = await this.#deps.db.rooms();
    this.#lastReadAt = this.#deps.now();
    return { group: sortedIds(sendableGroupRooms(rooms)), member: sortedIds(memberRooms(rooms)), replyable: sortedIds(sendableRooms(rooms)) };
  }

  #delivery(): DeliveryDeps {
    return {
      db: this.#deps.db,
      landingMs: this.#deps.landingMs,
      landingStepMs: this.#deps.landingStepMs,
      messenger: this.#deps.messenger,
      myUserId: this.#myUserId,
      sleep: this.#deps.sleep,
      ui: this.#deps.ui,
    };
  }

  // One claim and its result; what happened, for the loop and the tests.
  async claimOnce(): Promise<{ readonly status: "locked" | "idle" | "standby" | "error" } | { readonly status: "done"; readonly id: string; readonly outcome: Outcome }> {
    const probe = await this.#deps.ui.probe();
    if (probe.locked) return { status: "locked" };
    const rooms = await this.#rooms();
    const body = JSON.stringify({ groupRooms: rooms.group, locked: false, memberRooms: rooms.member, postedRooms: [], relay: "mac", replyableRooms: rooms.replyable });
    const answer = await this.#deps.post("/kakaotalk/outbox/claim", body, this.#deps.config.outboxSecret);
    if (answer.status === 204 || (answer.status === 200 && (answer.body === null || (typeof answer.body === "object" && Object.keys(answer.body).length === 0)))) {
      return { status: "idle" };
    }
    if (answer.status === 409) return { status: "standby" };
    if (answer.status !== 200 || !isClaim(answer.body)) return { status: "error" };

    const claim = answer.body;
    let outcome: Outcome;
    try {
      if (claim.mode === "reply" && typeof claim.roomId === "string" && typeof claim.text === "string" && claim.text !== "") {
        outcome = await sendToRoom(this.#delivery(), claim.roomId, claim.text);
      } else if (claim.mode === "leave" && typeof claim.roomId === "string") {
        outcome = await leaveRoom(this.#delivery(), claim.roomId);
      } else {
        // A nudge, an unknown mode or a missing field: the Mac relay sends nothing (design 6).
        outcome = { detail: `unsupported claim ${String(claim.mode)}`, outcome: "failed" };
      }
    } catch (error) {
      // sendToRoom and leaveRoom turn errors after kakaocli or the helper ran
      // into uncertain or failed themselves, so an error here came before: safe to retry.
      outcome = { detail: error instanceof Error ? error.message : "error", outcome: "not_started" };
    }
    this.#log("claim done", { detail: outcome.detail, id: claim.id, outcome: outcome.outcome, reason: outcome.reason });
    await this.#report(claim, outcome);
    return { id: claim.id, outcome, status: "done" };
  }

  // Reports a result, again on a network error, 429 or 5xx, every 3 s for up to 100 s.
  async #report(claim: Claim, outcome: Outcome) {
    const body = JSON.stringify({ leaseToken: claim.leaseToken, outcome: outcome.outcome, relay: "mac", ...(outcome.reason ? { reason: outcome.reason } : {}) });
    const path = `/kakaotalk/outbox/${encodeURIComponent(claim.id)}/result`;
    for (let waited = 0; waited <= 100_000; waited += 3_000) {
      const answer = await this.#deps.post(path, body, this.#deps.config.outboxSecret);
      if (answer.status >= 200 && answer.status < 300) return true;
      if (answer.status >= 400 && answer.status < 500 && answer.status !== 429) {
        this.#log("result refused", { id: claim.id, status: answer.status });
        return false;
      }
      await this.#deps.sleep(3_000);
    }
    return false;
  }

  async beatOnce() {
    const probe = await this.#deps.ui.probe();
    let replyable: string[] = [];
    try {
      replyable = (await this.#rooms()).replyable;
    } catch (error) {
      this.#log("database unreadable", { error: error instanceof Error ? error.message : "error" });
    }
    const body = JSON.stringify({
      accessibilityEnabled: probe.trusted,
      kakaoVersion: probe.kakaoVersion,
      listenerEnabled: probe.kakaoRunning && this.#deps.now() - this.#lastReadAt <= 120_000,
      locked: probe.locked,
      postedRooms: [],
      relay: "mac",
      replyableRooms: replyable,
    });
    return this.#deps.post("/kakaotalk/heartbeat", body, this.#deps.config.outboxSecret);
  }

  // Runs the three loops until the signal aborts.
  async run(signal: AbortSignal) {
    const loop = async (name: string, body: () => Promise<number>) => {
      while (!signal.aborted) {
        let wait: number;
        try {
          wait = await body();
        } catch (error) {
          this.#log(`${name} failed`, { error: error instanceof Error ? error.message : "error" });
          wait = 5_000;
        }
        await this.#deps.sleep(wait);
      }
    };
    let backoff = 5_000;
    await Promise.all([
      loop("watch", async () => {
        await this.watchOnce();
        return 2_000;
      }),
      loop("heartbeat", async () => {
        const answer = await this.beatOnce();
        if (answer.status !== 200) this.#log("heartbeat answered", { status: answer.status });
        return 60_000;
      }),
      loop("claim", async () => {
        const result = await this.claimOnce();
        if (result.status === "error" || result.status === "standby") {
          backoff = Math.min(backoff * 2, 60_000);
          return result.status === "standby" ? 60_000 : backoff;
        }
        backoff = 5_000;
        return result.status === "locked" ? 5_000 : result.status === "idle" ? 2_000 : 0;
      }),
    ]);
  }
}
