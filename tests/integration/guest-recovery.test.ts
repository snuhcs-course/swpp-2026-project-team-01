import { randomUUID } from "node:crypto";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, describe, expect, it } from "vitest";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { createRequesterRecoverHandler } from "../../lib/server/requester-routes";
import { testDatabase } from "./support/database";
import { call, guestDependencies, recordingRuntime, type Sent } from "./support/guests";
import { closeTestRequest, createTestRequest } from "./support/requests";
import { indexRequesterSession } from "./support/scheduling";

// **Recover conversation** on the booking page (chat-workspaces: equivalent
// safe recovery for the requester): a generation whose recorded stream ends in
// a terminal failure gets exactly one successor, keeps its history and
// continues its unfinished input; anything else is refused. The runtime is a
// stand-in that records what it was sent.

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function runtime(events: MessageStreamEvent[], sent: Sent[]): ConversationRuntime {
  return {
    ...recordingRuntime(sent),
    readRecordedEvents: () =>
      (async function* () {
        yield* events;
      })(),
  };
}

const FAILED = [
  { data: { message: "Hello" }, type: "message.received" },
  { data: {}, type: "session.failed" },
] as unknown as MessageStreamEvent[];

async function failedRequester() {
  const request = await createTestRequest(db);
  const session = await indexRequesterSession(db, request.requestId);
  await db`update app.agent_sessions set state = 'failed' where session_id = ${session.sessionId}`;
  const [input] = await db<{ id: string }[]>`
    insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message, state, session_id, sent_at)
    values (${session.discussionId}, ${randomUUID()}, 'fingerprint', 'Is Monday possible?', 'sent', ${session.sessionId}, now())
    returning id
  `;
  return { ...request, inputId: input!.id, session };
}

function recover(bookingId: string, generation: number, events: MessageStreamEvent[], sent: Sent[] = []) {
  const deps = guestDependencies(db, { runtime: runtime(events, sent) });
  return call(createRequesterRecoverHandler(() => deps), { bookingId }, `/api/requests/${bookingId}/recover`, {
    body: { observedGeneration: generation },
  });
}

describe("requester conversation recovery", () => {
  it("replaces a failed generation once and continues its unfinished input", async () => {
    const r = await failedRequester();
    const sent: Sent[] = [];

    const response = await recover(r.bookingId, 1, FAILED, sent);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ delivered: true, generation: 2, status: "recovered" });
    const sessions = await db<{ generation: number; last_stream_index: number | null; state: string }[]>`
      select generation, state, last_stream_index from app.agent_sessions where discussion_id = ${r.session.discussionId}
      order by generation
    `;
    expect(sessions).toEqual([
      { generation: 1, last_stream_index: 2, state: "retired" },
      { generation: 2, last_stream_index: null, state: "active" },
    ]);
    expect(sent.map((entry) => entry.message)).toEqual(["Is Monday possible?"]);

    // An exact retry answers with the same transition and creates nothing.
    const retry = await recover(r.bookingId, 1, FAILED);
    expect(await retry.json()).toMatchObject({ generation: 2, status: "recovered" });
    const [count] = await db<{ count: number }[]>`
      select count(*)::int as count from app.agent_sessions where discussion_id = ${r.session.discussionId}
    `;
    expect(count!.count).toBe(2);
  });

  it("refuses a generation with no terminal failure on record", async () => {
    const r = await failedRequester();

    const response = await recover(r.bookingId, 1, [{ data: {}, type: "session.waiting" }] as unknown as MessageStreamEvent[]);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: "not_failed" });
  });

  it("gives a closed request the generic unavailable answer", async () => {
    const r = await failedRequester();
    await closeTestRequest(db, r.requestId);

    expect((await recover(r.bookingId, 1, FAILED)).status).toBe(404);
  });
});
