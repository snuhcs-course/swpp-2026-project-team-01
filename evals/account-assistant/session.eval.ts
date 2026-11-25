import { createHash, randomUUID } from "node:crypto";
import { defineEval, type EveEvalContext } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { EVAL_HOST_HEADER } from "../../lib/server/eve-auth";
import { sessionIdHash } from "../../lib/server/model-limits";
import { agreedRequest } from "../../tests/integration/support/booking";
import { storyRuntime } from "../story/runtime";

// Real tools and domain commands against the existing local fake-provider
// runtime. Needs explicit local-stack/model permission; never run on shared DB.
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function accountSession(t: EveEvalContext, hostAccountId: string) {
  const { db } = storyRuntime();
  const [discussion] = await db<{ id: string }[]>`insert into app.discussions (principal_type, principal_id, audience)
    values ('host_account', ${hostAccountId}, 'host_setup') returning id`;
  const sender = hash(randomUUID());
  await db`insert into app.imessage_bindings (host_account_id, channel, sender_hash, sender_ciphertext, sealed_key_id)
    values (${hostAccountId}, 'telegram', ${sender}, 'eval-sealed', 'eval')`;
  const session = await t.session({ headers: { [EVAL_HOST_HEADER]: hostAccountId }, stubs: [] });
  await db`insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
    values (${session.sessionId}, ${sessionIdHash(session.sessionId)}, ${discussion!.id}, 'host_account', ${hostAccountId}, 1, 'account-eval')`;
  return async (text: string) => {
    const id = randomUUID();
    const message = `[Telegram] ${text}`;
    await db`insert into app.imessage_receipts (id, channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256, outcome, processed_at)
      values (${id}, 'telegram', ${id}, 'eval', ${sender}, ${hash(id)}, 'dm', 'text', ${hash(message)}, 'forwarded', now())`;
    const [input] = await db<{ id: string }[]>`insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message, state, session_id)
      values (${discussion!.id}, ${id}, ${hash(message)}, ${message}, 'sent', ${session.sessionId}) returning id`;
    await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${session.sessionId}`;
    return session.send(message);
  };
}
export default [
  defineEval({ description: "AS-01: two received decisions in one account turn", tags: ["account-assistant", "live-model"], timeoutMs: 180_000, async test(t) {
    const { db, google } = storyRuntime();
    const a = await agreedRequest(db, google, { requesterName: "Eunwoo" });
    const b = await agreedRequest(db, google, { sameHostAs: a, requesterName: "Dohyeon", candidateIndex: 1 });
    const send = await accountSession(t, a.hostAccountId);
    const turn = await send("Approve Eunwoo's and decline Dohyeon's.");
    t.succeeded();
    t.check(turn.toolCalls.some(call => call.name === "decide_requests"), satisfies((ok: boolean) => ok, "uses one batch interface"));
    const states = await db<{ id: string; state: string }[]>`select id, state from app.requests where id in (${a.requestId}, ${b.requestId})`;
    t.check(states.find(row => row.id === a.requestId)?.state, satisfies((value: string | undefined) => value === "booking" || value === "booked", "Eunwoo approved"));
    t.check(states.find(row => row.id === b.requestId)?.state, satisfies((value: string | undefined) => value === "declined", "Dohyeon declined"));
    const schedule = await send("What does my next week look like?");
    t.check(schedule.toolCalls.some(call => call.name === "read_schedule"), satisfies((ok: boolean) => ok, "schedule available after decisions"));
  } }),
  defineEval({ description: "AS-02: own schedule from anywhere in the account conversation", tags: ["account-assistant", "live-model"], timeoutMs: 180_000, async test(t) {
    const { db, google } = storyRuntime();
    const request = await agreedRequest(db, google);
    const send = await accountSession(t, request.hostAccountId);
    for (const message of ["Show me my schedule tomorrow.", "나 다음 주에 약속 없는지 확인해 줄래?"]) {
      const turn = await send(message);
      t.check(turn.toolCalls.some(call => call.name === "read_schedule"), satisfies((ok: boolean) => ok, "reads own schedule"));
    }
    t.succeeded();
  } }),
];
