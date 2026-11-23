import { randomUUID } from "node:crypto";
import type { ToolStub } from "eve/evals";
import { readCalendarRoles, saveCalendarRolesCommand } from "../../lib/server/calendar-roles";
import { setUpManuallyCommand } from "../../lib/server/analysis";
import { runCommand } from "../../lib/server/commands";
import { EVAL_HOST_HEADER } from "../../lib/server/eve-auth";
import { sessionIdHash } from "../../lib/server/model-limits";
import { updateDraftCommand } from "../../lib/server/setup-commands";
import { createCalendarHost } from "../../tests/integration/support/calendar-host";
import { storyRuntime } from "../story/runtime";
import type { DraftFields } from "./setup-cases";

// Host setup eval fixtures. Each eval seeds, in the local database the story
// runtime points the dev server at (story/runtime.ts), an active host with a
// Calendar grant on the fake Google, its calendar roles saved, the scan
// skipped and Online chosen, the way tests/integration/support/setup-host.ts
// prepares a reviewable host; then its host setup discussion and an indexed
// session. The eval channel entry admits the session as that host's setup
// principal (lib/server/eve-auth.ts, createEvalHostSetupAuth). Every setup tool
// runs for real; nothing is saved, because first-time setup is saved only with
// the host's own card.

export type SetupTurnResult = {
  readonly message: string | null | undefined;
  readonly toolCalls: readonly { readonly name: string }[];
};
type EvalContext = {
  session(options: { headers: Record<string, string>; stubs: ToolStub[] }): Promise<{
    readonly sessionId: string;
    send(message: string): Promise<SetupTurnResult>;
  }>;
};

async function seedSetupHost() {
  const { db, google, tokenKey } = storyRuntime();
  const host = await createCalendarHost(db, tokenKey);
  const calendar = { accessRole: "owner", id: host.email, primary: true, summary: "Work", timeZone: "Asia/Seoul" };
  google.setFixture(host.refreshToken!, { calendars: [calendar as never], events: { [host.email]: [] } });

  const deps = { authenticate: async () => ({ id: host.hostAccountId, kind: "host_account" as const }), db };
  const roles = await runCommand(deps, saveCalendarRolesCommand([calendar as never]), {
    expectedRevision: (await readCalendarRoles(db, host.hostAccountId))?.revision ?? 0,
    input: { bookingCalendarId: host.email, conflictCalendarIds: [host.email] },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  const manual = await runCommand(deps, setUpManuallyCommand, { input: {}, resourceId: host.hostAccountId, retryKey: randomUUID() });
  const mode = await runCommand(deps, updateDraftCommand, {
    expectedRevision: await draftRevision(host.hostAccountId),
    input: { action: "choose_own", field: "meetingMode", value: "online" },
    resourceId: host.hostAccountId,
    retryKey: randomUUID(),
  });
  if (!roles.ok || !manual.ok || !mode.ok) throw new Error(`Preparing the setup host failed: ${JSON.stringify([roles, manual, mode])}`);

  const [discussion] = await db<{ id: string }[]>`
    insert into app.discussions (principal_type, principal_id, audience)
    values ('host_account', ${host.hostAccountId}, 'host_setup') returning id
  `;
  return { discussionId: discussion!.id, hostAccountId: host.hostAccountId };
}

async function draftRevision(hostAccountId: string) {
  const [row] = await storyRuntime().db<{ revision: number }[]>`select revision from app.setup_drafts where host_account_id = ${hostAccountId}`;
  return row?.revision ?? 0;
}

// The setup draft's fields, which scheduling never reads until the host saves.
export async function readDraft(hostAccountId: string): Promise<DraftFields> {
  const [row] = await storyRuntime().db<{ fields: DraftFields }[]>`select fields from app.setup_drafts where host_account_id = ${hostAccountId}`;
  return row?.fields ?? {};
}

// Whether the host's settings were saved (they must not be: the web host saves with the card).
export async function settingsSaved(hostAccountId: string) {
  const [row] = await storyRuntime().db<{ count: number }[]>`select count(*)::int as count from app.host_settings where host_account_id = ${hostAccountId}`;
  return row!.count > 0;
}

// A host setup session over a seeded host, indexed as the message route
// indexes it; `send` moves the session to a fresh accepted input first.
export async function hostSetupSession(t: EvalContext) {
  const { db } = storyRuntime();
  const seeded = await seedSetupHost();
  const session = await t.session({ headers: { [EVAL_HOST_HEADER]: seeded.hostAccountId }, stubs: [] });
  await db`
    insert into app.agent_sessions
      (session_id, session_id_hash, discussion_id, principal_type, principal_id, generation, agent_version)
    values (${session.sessionId}, ${sessionIdHash(session.sessionId)}, ${seeded.discussionId}, 'host_account',
            ${seeded.hostAccountId}, 1, 'eval')
  `;
  return {
    hostAccountId: seeded.hostAccountId,
    async send(message: string) {
      await db`update app.agent_sessions set current_input_id = ${randomUUID()} where session_id = ${session.sessionId}`;
      return session.send(message);
    },
  };
}
