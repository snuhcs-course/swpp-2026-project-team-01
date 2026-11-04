import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { switchConversationForTool } from "../../lib/server/channel-selection";
import { requestRef } from "../../lib/server/imessage-commands";
import { sessionIdHash } from "../../lib/server/model-limits";
import { testDatabase } from "./support/database";
import { type FakePhoton, startFakePhoton } from "./support/fake-photon";
import { hostWithUser, imessageHarness } from "./support/imessage";
import { createTestRequest } from "./support/requests";

// Switching the linked conversation in words (host-imessage-channel D25, #125):
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

describe("switching in words", () => {
  it("selects the request a host names by requester, and the next message goes there", async () => {
    const { call, hostAccountId, sender } = await hostWrote("Let's talk about 박도현's request");
    const wanted = await named(hostAccountId, "박도현");
    await named(hostAccountId, "Ada Lovelace");

    const result = await switchConversationForTool(db, call, { to: "박도현" });
    expect(result).toMatchObject({ ref: requestRef(wanted), switched: true, to: "request" });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: wanted });

    expect((await im.deliver({ sender, text: "Is she flexible on Thursday?" })).outcome).toBe("forwarded");
    expect((await im.inputsOf(hostAccountId)).at(-1)).toMatchObject({ message: "[iMessage] Is she flexible on Thursday?", request_id: wanted });
  });

  it("selects a request by its reference, and goes back to setup", async () => {
    const { call, hostAccountId } = await hostWrote("6ADSRV please");
    const wanted = await named(hostAccountId, "Ada Lovelace");

    expect(await switchConversationForTool(db, call, { to: requestRef(wanted).toLowerCase() })).toMatchObject({ switched: true, to: "request" });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: wanted });

    expect(await switchConversationForTool(db, call, { to: "setup" })).toMatchObject({ switched: true, to: "setup" });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: null });
  });

  it("asks which one when a name matches more than one request, and switches nothing", async () => {
    const { call, hostAccountId } = await hostWrote("The request from Grace");
    await named(hostAccountId, "Grace Hopper");
    await named(hostAccountId, "Grace Kelly");

    const result = await switchConversationForTool(db, call, { to: "Grace" });
    expect(result).toMatchObject({ switched: false });
    expect("matches" in result ? result.matches : []).toHaveLength(2);
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: null });

    expect(await switchConversationForTool(db, call, { to: "Nobody" })).toMatchObject({ switched: false, problem: expect.stringContaining("No request matches") });
  });

  it("switches nothing for a message typed on the web", async () => {
    const { call, hostAccountId, inputId } = await hostWrote("Let's talk about Ada's request");
    await named(hostAccountId, "Ada Lovelace");
    await db`update app.conversation_inputs set message = 'Let''s talk about Ada''s request' where id = ${inputId}`;

    expect(await switchConversationForTool(db, call, { to: "Ada" })).toMatchObject({ switched: false, problem: expect.stringContaining("inbox") });
    expect(await im.bindingOf(hostAccountId)).toMatchObject({ selected_request_id: null });
  });
});
