import { createHash, randomUUID } from "node:crypto";
import type { EveEvalContext } from "eve/evals";
import { setUpManuallyCommand } from "../../lib/server/analysis";
import { readCalendarRoles, saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
import { runCommand } from "../../lib/server/commands";
import { EVAL_HOST_HEADER } from "../../lib/server/eve-auth";
import { bindingContext } from "../../lib/server/imessage-links";
import { createImessageNoticeHandler } from "../../lib/server/imessage-notice-job";
import { IMESSAGE_NOTICE_JOB } from "../../lib/server/imessage-notices";
import { createImessageSendHandler, IMESSAGE_SEND_JOB } from "../../lib/server/imessage-outbox";
import { sessionIdHash } from "../../lib/server/model-limits";
import { photonConfig, type PhotonContent, type PhotonTransport } from "../../lib/server/photon";
import { channelHash } from "../../lib/server/photon-receiver";
import { sealToken } from "../../lib/server/token-encryption";
import { createCalendarHost, hostCommandDeps, runJob } from "../../tests/integration/support/calendar-host";
import { storyRuntime } from "../story/runtime";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// All grants, bindings, tool-produced previews and notices use the runtime key.
// No integration fixture's independently generated encryption key is used.
export async function setupHost(connected: boolean) {
  const { db, google, tokenKey } = storyRuntime();
  const host = await createCalendarHost(db, tokenKey, connected ? {} : { refreshToken: null });
  if (connected) {
    const calendar = { accessRole: "owner", id: host.email, primary: true, summary: "Work", timeZone: "Asia/Seoul" };
    google.setFixture(host.refreshToken!, { calendars: [calendar], events: { [host.email]: [] } });
    const deps = hostCommandDeps(db, host.hostAccountId);
    const roles = await runCommand(deps, saveCalendarRolesCommand([calendar]), {
      expectedRevision: (await readCalendarRoles(db, host.hostAccountId))?.revision ?? 0,
      input: { bookingCalendarId: host.email, conflictCalendarIds: [host.email] },
      resourceId: host.hostAccountId, retryKey: randomUUID(),
    });
    const manual = await runCommand(deps, setUpManuallyCommand, { input: {}, resourceId: host.hostAccountId, retryKey: randomUUID() });
    if (!roles.ok || !manual.ok) throw new Error("Could not prepare the hours-question start state");
  }
  return host;
}

export async function accountSession(t: EveEvalContext, hostAccountId: string) {
  const { db, tokenKey } = storyRuntime();
  await db`insert into app.discussions (principal_type, principal_id, audience)
    values ('host_account', ${hostAccountId}, 'host_setup') on conflict do nothing`;
  const [discussion] = await db<{ id: string }[]>`select id from app.discussions
    where principal_type = 'host_account' and principal_id = ${hostAccountId} and audience = 'host_setup'`;
  const bindingId = randomUUID();
  const chat = String(Math.floor(Math.random() * 1_000_000_000) + 1);
  const sender = channelHash(tokenKey, "telegram", "sender", chat);
  const sealed = sealToken(tokenKey, chat, bindingContext(bindingId));
  await db`insert into app.imessage_bindings (id, host_account_id, channel, sender_hash, sender_ciphertext, space_ciphertext, sealed_key_id)
    values (${bindingId}, ${hostAccountId}, 'telegram', ${sender}, ${sealed.ciphertext}, ${sealed.ciphertext}, ${tokenKey.id})`;
  const session = await t.session({ headers: { [EVAL_HOST_HEADER]: hostAccountId }, stubs: [] });
  await db`insert into app.agent_sessions (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
    values (${session.sessionId}, ${sessionIdHash(session.sessionId)}, ${discussion!.id}, 'host_account', ${hostAccountId}, 1, 'account-eval')`;
  const delivered: PhotonContent[] = [];
  // Only the messaging transport is a stand-in. The outbox handler checks the
  // binding, decrypts the real payload and records actual delivery acceptance.
  const transport: PhotonTransport = { endpoint: "http://127.0.0.1/account-eval-telegram", async send(request) {
    delivered.push(request.content);
    return { status: "accepted", messageId: randomUUID(), spaceId: chat };
  } };
  async function flush() {
    const notices = await db<{ id: string }[]>`select j.id from app.jobs j
      join app.requests r on r.id::text = j.payload ->> 'requestId'
      where j.kind = ${IMESSAGE_NOTICE_JOB} and j.state = 'pending' and r.host_account_id = ${hostAccountId}
      order by j.created_at, j.id`;
    const notice = createImessageNoticeHandler(() => ({ db, origin: process.env.APP_ORIGIN!, tokenKey, tokenKeys: [tokenKey] }));
    for (const job of notices) await runJob(db, job.id, notice);
    const sends = await db<{ id: string }[]>`select j.id from app.jobs j
      join app.imessage_outbox o on o.id::text = j.payload ->> 'outboxId'
      where j.kind = ${IMESSAGE_SEND_JOB} and j.state = 'pending' and o.host_account_id = ${hostAccountId}
        and o.state = 'queued' and o.kind in ('image', 'notice') order by o.created_at, o.id`;
    const handler = createImessageSendHandler(() => ({
      db, tokenKeys: [tokenKey], origin: process.env.APP_ORIGIN!, config: photonConfig({}), env: {},
      transport, telegramTransport: transport, signingKey: "unused-eval-send-key",
      runtime: { async createSession() { throw new Error("No new runtime session in the sender"); },
        async sendMessage() { throw new Error("No model turns in the sender"); },
        readEvents: () => (async function* () {})(),
        readRecordedEvents: () => (async function* () {})() },
    }));
    for (const job of sends) {
      // Keep fake deliveries independent of wall-clock Telegram chat spacing.
      await db`update app.imessage_outbox set dispatched_at = dispatched_at - interval '1 minute'
        where binding_id = ${bindingId} and dispatched_at is not null`;
      await runJob(db, job.id, handler);
    }
  }
  return { bindingId, delivered, sessionId: session.sessionId, flush,
    async send(text: string) {
      const id = randomUUID();
      const message = `[Telegram] ${text}`;
      await db`insert into app.imessage_receipts (id, channel, message_id, webhook_id, sender_hash, space_hash, space_type, content_type, payload_sha256, outcome, processed_at)
        values (${id}, 'telegram', ${id}, 'eval', ${sender}, ${hash(id)}, 'dm', 'text', ${hash(message)}, 'forwarded', now())`;
      const [input] = await db<{ id: string }[]>`insert into app.conversation_inputs (discussion_id, client_input_id, fingerprint, message, state, session_id)
        values (${discussion!.id}, ${id}, ${hash(message)}, ${message}, 'sent', ${session.sessionId}) returning id`;
      await db`update app.agent_sessions set current_input_id = ${input!.id} where session_id = ${session.sessionId}`;
      const turn = await session.send(message);
      await flush();
      return turn;
    },
  };
}
