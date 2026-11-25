import { writeContext, captureContext, readContext, recalledContext, forgetContext } from "../../lib/server/host-assistant-context";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountRequestCall } from "../../lib/server/account-assistant-tools";
import { requestRef } from "../../lib/server/imessage-commands";
import { sessionIdHash } from "../../lib/server/model-limits";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness } from "./support/imessage";
import { createTestRequest } from "./support/requests";

// Switching the linked conversation in words (host-imessage-channel D26, #125):
// from a message in the linked iMessage, the assistant's switch_conversation
// selects a request named by reference or requester name, or setup, so the
// host's next plain message reaches that discussion; an ambiguous or unknown
// name, or a message typed on the web, switches nothing.

const db = testDatabase();
let photon: FakePhoton;
const im = imessageHarness(db, () => photon);

beforeAll(async () => {
  photon = await startFakePhoton();
});

afterAll(async () => {
  await photon.close();
  await db.end();
});

async function named(hostAccountId: string, name: string) {
  const request = await createTestRequest(db, { hostAccountId });
  await db`update app.requests set requester_name = ${name} where id = ${request.requestId}`;
  return request.requestId;
}

// A linked host who wrote `text` from iMessage with no request selected, and the
// setup session answering that message, as the runtime would have started it.
async function hostWrote(text: string) {
  const { hostAccountId } = await hostWithUser(db);
  const { sender } = await im.link(hostAccountId);
  expect((await im.deliver({ sender, text })).outcome).toBe("forwarded");

  const [discussion] = await db<{ id: string }[]>`
    select id from app.discussions where principal_type = 'host_account' and principal_id = ${hostAccountId} and audience = 'host_setup'
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
      values (${sessionId}, ${sessionIdHash(sessionId)}, ${discussion!.id}, 'host_account', ${hostAccountId}, 1, 'test', ${input!.id})
    `;
  }

  const call = {
    auth: { attributes: { audience: "host_setup", discussionId: discussion!.id, generation: "1" }, principalId: hostAccountId, principalType: "user" as const },
    sessionId,
  };
  return { call, hostAccountId, inputId: input!.id, sender };
}

describe("account request references without switching", () => {
  it("reads a named owned target while the next message stays in the account discussion", async () => {
    const { call, hostAccountId, sender } = await hostWrote("Let's talk about 박도현's request");
    const wanted = await named(hostAccountId, "박도현");
    await named(hostAccountId, "Ada Lovelace");
    expect(await accountRequestCall(db, { ...call, callId: randomUUID() }, "박도현")).toMatchObject({ requestId: wanted, sessionId: call.sessionId });
    expect((await im.deliver({ sender, text: "What's on my schedule next week?" })).outcome).toBe("forwarded");
    expect((await im.inputsOf(hostAccountId)).at(-1)).toMatchObject({ message: "[iMessage] What's on my schedule next week?", request_id: null });
  });

  it("resolves an exact ref but refuses ambiguous names, foreign refs and non-messenger turns", async () => {
    const { call, hostAccountId, inputId } = await hostWrote("Read the request");
    const first = await named(hostAccountId, "Grace");
    await named(hostAccountId, "Grace");
    const toolCall = { ...call, callId: randomUUID() };
    expect(await accountRequestCall(db, toolCall, requestRef(first))).toMatchObject({ requestId: first });
    await expect(accountRequestCall(db, toolCall, "Grace")).rejects.toThrow("ambiguous");
    await expect(accountRequestCall(db, toolCall, randomUUID())).rejects.toThrow("unavailable");
    await db`update app.conversation_inputs set message = 'Read the request' where id = ${inputId}`;
    await expect(accountRequestCall(db, toolCall, requestRef(first))).rejects.toThrow();
  });
});

describe("private account memory persistence", () => {
  it("acknowledges, lists, forgets and refuses capture replay without a requester projection", async () => {
    const { call, hostAccountId } = await hostWrote("avoid Friday afternoons");
    const toolCall = { ...call, callId: randomUUID() };
    const entry = { kind: "memory", key: "fridays", expectedRevision: 0, content: { memory: { text: "avoid Friday afternoons", category: "soft_preference", expiresAt: null }, notice: "I'll remember: avoid Friday afternoons" }, operationId: "test-turn:remember-fridays" } satisfies Parameters<typeof writeContext>[3];
    expect(await writeContext(db, toolCall, "account-scope", entry)).toEqual({ saved: true, revision: 1 });
    expect(recalledContext(await readContext(db, hostAccountId, "account-scope")).memories).toEqual([]);
    await captureContext(db, toolCall, "account-scope", "capture-fridays", [{ role: "assistant", content: "I'll remember: avoid Friday afternoons" }], "test-turn");
    expect(recalledContext(await readContext(db, hostAccountId, "account-scope")).memories).toHaveLength(1);
    expect(await forgetContext(db, toolCall, "account-scope", "fridays", 1, "memory")).toEqual({ forgotten: true });
    await captureContext(db, toolCall, "account-scope", "capture-fridays", [{ role: "assistant", content: "I'll remember: avoid Friday afternoons" }], "test-turn");
    expect(await writeContext(db, toolCall, "account-scope", entry)).toMatchObject({ saved: false });
    expect(recalledContext(await readContext(db, hostAccountId, "account-scope")).memories).toEqual([]);
    expect(await readContext(db, hostAccountId, "another-account-scope")).toEqual([]);
  });
});
