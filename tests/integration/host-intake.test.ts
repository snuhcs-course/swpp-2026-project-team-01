import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { runCommand } from "../../lib/server/commands";
import { readHostIntake, setHostIntakeCommand } from "../../lib/server/host-intake";
import { findReadyHostByHandle } from "../../lib/server/readiness";
import { hostAcceptsRequests, hostCanContinueRequests } from "../../lib/server/request-guard";
import { testDatabase } from "./support/database";
import { readyHost } from "./support/guests";

const db = testDatabase();
afterAll(async () => db.end());

describe("host intake preference", () => {
  it("defaults on, saves a revisioned pause, replays a lost response, and rejects stale views", async () => {
    const host = await readyHost(db);
    const actor = { id: host.hostAccountId, kind: "host_account" as const };
    const deps = { authenticate: async () => actor, db };
    const request = { expectedRevision: 0, input: { accepting: false }, resourceId: host.hostAccountId, retryKey: randomUUID() };

    expect(await readHostIntake(db, host.hostAccountId)).toMatchObject({ accepting: true, revision: 0 });
    expect(await findReadyHostByHandle(db, host.handle)).not.toBeNull();

    expect(await runCommand(deps, setHostIntakeCommand, request)).toMatchObject({ ok: true, replayed: false, result: { accepting: false, revision: 1 } });
    expect(await runCommand(deps, setHostIntakeCommand, request)).toMatchObject({ ok: true, replayed: true, result: { accepting: false, revision: 1 } });
    expect(await readHostIntake(db, host.hostAccountId)).toMatchObject({ accepting: false, revision: 1 });
    expect(await findReadyHostByHandle(db, host.handle)).toBeNull();
    expect(await db.begin((tx) => hostAcceptsRequests(tx, host.hostAccountId))).toBe(false);
    expect(await db.begin((tx) => hostCanContinueRequests(tx, host.hostAccountId))).toBe(true);

    const stale = await runCommand(deps, setHostIntakeCommand, { ...request, input: { accepting: true }, retryKey: randomUUID() });
    expect(stale).toMatchObject({ ok: false, error: { category: "stale_revision" } });
    expect(await readHostIntake(db, host.hostAccountId)).toMatchObject({ accepting: false, revision: 1 });

    expect(await runCommand(deps, setHostIntakeCommand, { expectedRevision: 1, input: { accepting: true }, resourceId: host.hostAccountId, retryKey: randomUUID() })).toMatchObject({ ok: true, result: { accepting: true, revision: 2 } });
    expect(await findReadyHostByHandle(db, host.handle)).not.toBeNull();

    await db`update app.host_accounts set status = 'suspended' where id = ${host.hostAccountId}`;
    expect(await runCommand(deps, setHostIntakeCommand, { expectedRevision: 2, input: { accepting: false }, resourceId: host.hostAccountId, retryKey: randomUUID() })).toMatchObject({ ok: false, error: { category: "forbidden" } });
    expect(await findReadyHostByHandle(db, host.handle)).toBeNull();
  });

  it("keeps a saved on choice ineffective when Calendar access is lost", async () => {
    const host = await readyHost(db);
    await db`update app.provider_grants set invalidated_at = now() where host_account_id = ${host.hostAccountId}`;
    expect(await readHostIntake(db, host.hostAccountId)).toMatchObject({ accepting: true });
    expect(await findReadyHostByHandle(db, host.handle)).toBeNull();
    expect(await db.begin((tx) => hostAcceptsRequests(tx, host.hostAccountId))).toBe(false);
  });
});
