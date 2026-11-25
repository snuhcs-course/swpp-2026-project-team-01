import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestRef } from "../../lib/server/imessage-commands";
import { allowHostTripForHostTool, approveProposalForTool, askGuestForHostTool, waiveWeeklyLimitForHostTool } from "../../lib/server/host-review-tools";
import type { ConversationRuntime } from "../../lib/server/conversations";
import { sessionIdHash } from "../../lib/server/model-limits";
import { agreedRequest } from "./support/booking";
import { testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { imessageHarness } from "./support/imessage";

// Approval in the host's own words (host-imessage-channel D23, design 19): in a
// host's review of one request, approve_proposal approves the current agreed
// version through the same command as the web button, but only while the turn
// answers a message from the linked iMessage or WhatsApp; a web message, an
// outdated version or a closed request approves nothing.

const db = testDatabase();
let photon: FakePhoton;
let google: FakeGoogle;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
  google = await startFakeGoogle();
});

afterAll(async () => {
  await photon.close();
  await google.close();
  await db.end();
});

// A linked host with an agreed proposal, who selected the request and wrote
// `text` from iMessage, and the host-review session answering that message, as
// the runtime would have started it.
async function hostWrote(text: string) {
  const request = await agreedRequest(db, google);
  const { sender } = await im.link(request.hostAccountId);
  await im.deliver({ sender, text: `request ${requestRef(request.requestId)}` });
  expect((await im.deliver({ sender, text })).outcome).toBe("forwarded");

  const [discussion] = await db<{ id: string }[]>`
    select id from app.discussions
    where principal_type = 'host_account' and principal_id = ${request.hostAccountId} and audience = 'host_review' and request_id = ${request.requestId}
  `;
  const [input] = await db<{ id: string }[]>`
    select id from app.conversation_inputs where discussion_id = ${discussion!.id} order by accepted_at desc limit 1
  `;
  const [existing] = await db<{ session_id: string }[]>`
    select session_id from app.agent_sessions where discussion_id = ${discussion!.id} and state = 'active' order by generation desc limit 1
  `;
  let sessionId = existing?.session_id;
  if (sessionId) {
    await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${sessionId}`;
  } else {
    sessionId = `session_${randomUUID()}`;
    await db`
      insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version, current_input_id)
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'host_account', ${request.hostAccountId}, 1, 'test', ${input!.id})
    `;
  }

  const call = {
    auth: {
      attributes: { audience: "host_review", discussionId: discussion!.id, generation: "1", requestId: request.requestId },
      principalId: request.hostAccountId,
      principalType: "user" as const,
    },
    callId: randomUUID(),
    sessionId,
  };
  return { call, inputId: input!.id, request };
}

async function approvalsOf(requestId: string) {
  const [row] = await db<{ count: number }[]>`select count(*)::int as count from app.approvals where request_id = ${requestId}`;
  return row!.count;
}

describe("approval in words", () => {
  it("approves the current proposal for a message from iMessage, once", async () => {
    const { call, request } = await hostWrote("Looks good, book it");

    const approved = await approveProposalForTool(db, call, { version: 1 });
    expect(approved).toMatchObject({ approved: true });
    expect(await approvalsOf(request.requestId)).toBe(1);
    const [booking] = await db<{ state: string }[]>`select state from app.bookings where request_id = ${request.requestId}`;
    expect(booking).toBeDefined();

    // A second call observes the same approval and makes no other booking.
    const again = await approveProposalForTool(db, { ...call, callId: randomUUID() }, { version: 1 });
    expect(again).toMatchObject({ approved: true, message: expect.stringContaining("already approved") });
    expect(await approvalsOf(request.requestId)).toBe(1);
  });

  it("approves nothing for a message typed on the web", async () => {
    const { call, inputId, request } = await hostWrote("Looks good, book it");
    await db`update app.conversation_inputs set message = 'Looks good, book it' where id = ${inputId}`;

    expect(await approveProposalForTool(db, call, { version: 1 })).toMatchObject({ approved: false, problem: expect.stringContaining("Approve this proposal") });
    expect(await approvalsOf(request.requestId)).toBe(0);
  });

  it("approves nothing for a version that is not the current proposal", async () => {
    const { call, request } = await hostWrote("Yes, book it");

    expect(await approveProposalForTool(db, call, { version: 2 })).toMatchObject({ approved: false, problem: expect.stringContaining("version 1") });
    expect(await approvalsOf(request.requestId)).toBe(0);
  });

  it("approves nothing once the request is closed", async () => {
    const { call, request } = await hostWrote("Book it");
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${request.requestId}`;

    expect(await approveProposalForTool(db, call, { version: 1 })).toMatchObject({ approved: false });
    expect(await approvalsOf(request.requestId)).toBe(0);
  });
});

describe("provisional host question (#327)", () => {
  const delivery = {
    runtime: {
      createSession: async () => `session_${randomUUID()}`,
      sendMessage: async () => {},
      readEvents: async function* () {},
      readRecordedEvents: async function* () {},
    } satisfies ConversationRuntime,
    signingKey: "host-question-integration-signing-key",
  };

  it("records one authored guest-web question on retry, without changing the request", async () => {
    const { call, request } = await hostWrote("Ask the guest whether they need parking");
    const before = await db<{ revision: number }[]>`select revision from app.requests where id = ${request.requestId}`;

    expect(await askGuestForHostTool(db, call, { question: "Do you need parking?" }, delivery)).toMatchObject({ asked: true, messengerQueued: false });
    expect(await askGuestForHostTool(db, call, { question: "Do you need parking?" }, delivery)).toMatchObject({ asked: true, messengerQueued: false });

    const inputs = await db<{ message: string }[]>`
      select i.message from app.conversation_inputs i
      join app.discussions d on d.id = i.discussion_id
      where d.principal_type = 'requester_request' and d.principal_id = ${request.requestId}
        and i.message like 'The meeting host asks about:%'
    `;
    expect(inputs).toEqual([{ message: "The meeting host asks about: Do you need parking?" }]);
    expect((await db<{ revision: number }[]>`select revision from app.requests where id = ${request.requestId}`)[0]!.revision).toBe(before[0]!.revision);
  });

  it("posts nothing for a web turn or a closed request", async () => {
    const { call, inputId, request } = await hostWrote("Ask about parking");
    await db`update app.conversation_inputs set message = 'Ask about parking' where id = ${inputId}`;
    expect(await askGuestForHostTool(db, call, { question: "Do you need parking?" }, delivery)).toMatchObject({ asked: false });

    await db`update app.conversation_inputs set message = '[iMessage] Ask about parking' where id = ${inputId}`;
    await db`update app.requests set state = 'withdrawn', closed_at = now() where id = ${request.requestId}`;
    expect(await askGuestForHostTool(db, call, { question: "Do you need parking?" }, delivery)).toMatchObject({ asked: false });
  });
});

describe("messenger-only host exceptions (#327)", () => {
  it("refuses a web turn before changing either exception", async () => {
    const { call, inputId, request } = await hostWrote("Let this one go over the limit");
    await db`update app.conversation_inputs set message = 'Let this one go over the limit' where id = ${inputId}`;
    expect(await waiveWeeklyLimitForHostTool(db, call)).toMatchObject({ allowed: false, problem: expect.stringContaining("linked") });
    expect(await allowHostTripForHostTool(db, call, {
      candidateId: "candidate-1", direction: "inbound", evaluationId: randomUUID(), minutes: 30,
    })).toMatchObject({ allowed: false, problem: expect.stringContaining("linked") });
    expect(await db`select id from app.request_exceptions where request_id = ${request.requestId}`).toHaveLength(0);
    expect(await db`select id from app.travel_allowances where request_id = ${request.requestId}`).toHaveLength(0);
  });
});
