import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { parseTokenKey } from "../../lib/server/token-encryption";
import { createCalendarHost } from "./support/calendar-host";
import { testDatabase } from "./support/database";

const db = testDatabase();
const key = parseTokenKey(randomBytes(32).toString("base64"));

afterAll(async () => {
  await db.end();
});

// Inserts analysis rows created `hoursAgo` hours ago and returns their IDs.
async function analyses(hostAccountId: string, count: number, hoursAgo: number) {
  const rows = await db<{ id: string }[]>`
    insert into app.calendar_analyses (host_account_id, roles_revision, state, range_start, range_end, created_at)
    select ${hostAccountId}, 1, 'completed', now() - interval '28 days', now() + interval '28 days',
           now() - make_interval(hours => ${hoursAgo})
    from generate_series(1, ${count})
    returning id
  `;
  return rows.map((row) => row.id);
}

async function remaining(ids: readonly string[]) {
  const rows = await db<{ id: string }[]>`select id from app.calendar_analyses where id = any (${ids as string[]})`;
  return rows.map((row) => row.id).sort();
}

async function cleanup(batch: number) {
  const [row] = await db<{ removed: number }[]>`select app.cleanup_calendar_analyses(${batch}) as removed`;
  return row!.removed;
}

// Runs passes until one removes nothing, checking that no pass exceeds its batch.
async function cleanupUntilIdle(batch: number) {
  for (let pass = 0; pass < 1000; pass += 1) {
    const removed = await cleanup(batch);
    expect(removed).toBeLessThanOrEqual(batch);
    if (removed === 0) return pass;
  }
  throw new Error("cleanup never became idle");
}

describe("calendar analysis cleanup", () => {
  it("removes expired rows in bounded passes and keeps recent ones", async () => {
    const host = await createCalendarHost(db, key);
    const expired = await analyses(host.hostAccountId, 5, 25);
    const recent = await analyses(host.hostAccountId, 1, 23);

    const passes = await cleanupUntilIdle(2);

    expect(passes).toBeGreaterThanOrEqual(3);
    expect(await remaining(expired)).toEqual([]);
    expect(await remaining(recent)).toEqual(recent);
  });

  it("skips a row another transaction holds and removes it on a later pass", async () => {
    const host = await createCalendarHost(db, key);
    const [locked] = await analyses(host.hostAccountId, 1, 30);
    let release!: () => void;
    let lockedSignal!: () => void;
    const held = new Promise<void>((resolve) => (lockedSignal = resolve));
    const holder = db.begin(async (tx) => {
      await tx`select id from app.calendar_analyses where id = ${locked!} for update`;
      lockedSignal();
      await new Promise<void>((resolve) => (release = resolve));
    });

    await held;
    await cleanupUntilIdle(500);
    expect(await remaining([locked!])).toEqual([locked]);

    release();
    await holder;
    await cleanupUntilIdle(500);
    expect(await remaining([locked!])).toEqual([]);
  });

  it("removes expired sign-up attempts too", async () => {
    const hash = `cleanup-test-${randomBytes(8).toString("hex")}`;
    await db`
      insert into app.signup_attempts (source_hash, created_at)
      values (${hash}, now() - interval '25 hours'), (${hash}, now() - interval '1 hour')
    `;

    await cleanupUntilIdle(500);

    const rows = await db`select created_at from app.signup_attempts where source_hash = ${hash}`;
    expect(rows).toHaveLength(1);
  });

  it("leaves adopted draft and confirmed values untouched", async () => {
    const host = await createCalendarHost(db, key);
    const [analysisId] = await analyses(host.hostAccountId, 1, 48);
    const fields = { durationMinutes: { accepted: true, reason: "From 12 meetings.", sampleSize: 12, source: "inferred", value: 45 } };
    const settings = { durationMinutes: 45, provenance: { durationMinutes: "inferred" } };
    await db`insert into app.setup_drafts (host_account_id, fields) values (${host.hostAccountId}, ${db.json(fields)})`;
    await db`
      insert into app.host_settings (host_account_id, settings, draft_revision)
      values (${host.hostAccountId}, ${db.json(settings)}, 1)
    `;

    await cleanupUntilIdle(500);

    expect(await remaining([analysisId!])).toEqual([]);
    const [draft] = await db`select fields, revision from app.setup_drafts where host_account_id = ${host.hostAccountId}`;
    const [confirmed] = await db`select settings, revision from app.host_settings where host_account_id = ${host.hostAccountId}`;
    expect(draft).toEqual({ fields, revision: 1 });
    expect(confirmed).toEqual({ revision: 1, settings });
  });

  it.each(["authenticated", "anon"])("cannot be executed as the %s Data API role", async (role) => {
    const host = await createCalendarHost(db, key);
    const [expired] = await analyses(host.hostAccountId, 1, 30);

    await expect(
      db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select app.cleanup_calendar_analyses(500)`;
      }),
    ).rejects.toThrow(/permission denied/);

    expect(await remaining([expired!])).toEqual([expired]);
    await db`delete from app.calendar_analyses where id = ${expired!}`;
  });
});
