import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { approveCommand } from "../../lib/server/bookings";
import { type CommandDefinition, CommandError, runCommand } from "../../lib/server/commands";
import type { Database } from "../../lib/server/database";
import { type AdminDependencies, runAdmin } from "../../lib/server/operator";
import { agreedRequest, asHost } from "./support/booking";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { revisionOf } from "./support/scheduling";

// The operator's diagnostics (operational-diagnostics; operations-and-release
// design 4 and 5) against the local stack: the snapshot's categories, bounded
// deterministic samples, redaction and read-only behavior, and the rejection
// counts the command pipeline records. Rows this file seeds are dated in 1970 so
// they are the oldest in their category whatever other suites left behind.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function admin() {
  const out: string[] = [];
  const err: string[] = [];
  const deps: AdminDependencies = {
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL },
    interactive: false,
    prompt: async () => "",
    stderr: (line) => err.push(line),
    stdout: (line) => out.push(line),
  };
  return { deps, err, out };
}

type Category = { name: string; count: number; oldestAt: string | null; sample: string[] };

async function snapshot(samples = 20) {
  const run = admin();
  expect(await runAdmin(["diagnostics", "snapshot", "--samples", String(samples), "--json", "--operator", "dana", "--local"], run.deps)).toBe(0);
  const parsed = JSON.parse(run.out.join("\n")) as { categories: Category[]; environment: string; notMeasured: string[]; observedAt: string };
  return { ...parsed, byName: Object.fromEntries(parsed.categories.map((category) => [category.name, category])), raw: run.out.join("\n") };
}

// A job in the given state, dated in 1970 plus `second` seconds, carrying private text.
async function oldJob(state: "exhausted" | "running" | "pending", second: number, secret: string) {
  const at = new Date(Date.UTC(1970, 0, 1, 0, 0, second)).toISOString();
  const [row] = await db<{ id: string }[]>`
    insert into app.jobs (kind, payload, producer_environment, state, attempts, max_attempts, run_after, lease_owner,
                          lease_expires_at, failure_category, outcome, updated_at)
    values ('diagnostics_probe', ${db.json({ note: secret })}, 'local', ${state}, 5, 5, ${at}, ${state === "running" ? "worker" : null},
            ${state === "running" ? at : null}, ${state === "exhausted" ? "handler_failed" : null},
            ${db.json({ error: secret })}, ${at})
    returning id
  `;
  return row!.id;
}

async function rejectionTotals() {
  const [row] = await db<{ snapshot: { categories: { name: string; total: number; saturated: boolean }[] } }[]>`
    select app.operator_rejection_snapshot() as snapshot
  `;
  return Object.fromEntries(row!.snapshot.categories.map((category) => [category.name, category.total]));
}

// A probe command that fails with the given category, or succeeds.
function failingCommand(category: "stale_revision" | "request_closed" | "invalid_input" | null): CommandDefinition<object, string> {
  return {
    input: z.object({}),
    operation: "diagnostics.probe",
    run: async () => {
      if (category) throw new CommandError(category);
      return "ok";
    },
  };
}

const enabled = { DIAGNOSTICS_REJECTIONS: "1" };

function asProbeHost(database: Database, command: CommandDefinition<object, string>, env: Record<string, string>) {
  return runCommand({ authenticate: async () => ({ id: randomUUID(), kind: "host_account" }), db: database, env }, command, {
    input: {},
    resourceId: randomUUID(),
    retryKey: randomUUID(),
  });
}

describe("diagnostics snapshot", () => {
  it("reports every category in a fixed order with the coverage it does not measure", async () => {
    const result = await snapshot();

    expect(result.environment).toBe("local");
    expect(result.categories.map((category) => category.name)).toEqual([
      "jobs_exhausted",
      "jobs_lease_expired",
      "jobs_overdue",
      "bookings_uncertain",
      "bookings_reserved_stale",
      "email_deliveries_uncertain",
      "email_replies_uncertain",
      "imessage_uncertain",
      "sessions_failed",
      "inputs_unanswered",
    ]);
    expect(result.notMeasured.join(" ")).toMatch(/authorization_denials.*stale_actions.*provider_readiness.*recipient_delivery/);
  });

  it("counts every match while the oldest-first sample stays bounded and deterministic, without private text", async () => {
    const secret = `private-${randomUUID()}`;
    const exhausted = [await oldJob("exhausted", 3, secret), await oldJob("exhausted", 1, secret), await oldJob("exhausted", 2, secret)];
    const leased = await oldJob("running", 1, secret);
    const overdue = await oldJob("pending", 1, secret);

    try {
      const first = await snapshot(2);
      const second = await snapshot(2);

      expect(first.byName.jobs_exhausted!.count).toBeGreaterThanOrEqual(3);
      expect(first.byName.jobs_exhausted!.sample).toEqual([exhausted[1], exhausted[2]]);
      expect(first.byName.jobs_exhausted!.oldestAt).toBe("1970-01-01T00:00:01+00:00");
      expect(second.byName.jobs_exhausted!.sample).toEqual(first.byName.jobs_exhausted!.sample);
      expect(first.byName.jobs_lease_expired!.sample[0]).toBe(leased);
      expect(first.byName.jobs_overdue!.sample[0]).toBe(overdue);
      expect(first.raw).not.toContain(secret);
      expect(first.raw).not.toContain("handler_failed");
      expect(first.raw).not.toContain("diagnostics_probe");
    } finally {
      await db`delete from app.jobs where kind = 'diagnostics_probe'`;
    }
  });

  it("reports an uncertain booking and an uncertain email without changing them", async () => {
    const request = await agreedRequest(db, google);
    const approved = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
      expectedRevision: await revisionOf(db, request.requestId),
    });
    if (!approved.ok) throw new Error(`approve failed: ${approved.error.category}`);
    const bookingId = approved.result.bookingId;
    const secret = `private-${randomUUID()}`;

    await db`
      update app.bookings set state = 'dispatching', dispatched_at = '1970-01-01T00:00:01Z',
        payload = ${db.json({ summary: secret })}
      where id = ${bookingId}
    `;
    const [email] = await db<{ id: string }[]>`
      insert into app.email_deliveries (kind, request_id, sender, recipients, template, language, state, completed_at)
      values ('status_pending', ${request.requestId}, 'no-reply@findmeatime.com', ${[`${secret}@example.test`]}, 'status_pending', 'en',
              'uncertain', '1970-01-01T00:00:01Z')
      returning id
    `;
    const before = await db`select state, payload, dispatched_at from app.bookings where id = ${bookingId}`;

    const result = await snapshot(1);

    expect(result.byName.bookings_uncertain!.sample).toEqual([bookingId]);
    expect(result.byName.email_deliveries_uncertain!.sample).toEqual([email!.id]);
    expect(result.raw).not.toContain(secret);
    expect(await db`select state, payload, dispatched_at from app.bookings where id = ${bookingId}`).toEqual(before);
    expect(await db`select state from app.email_deliveries where id = ${email!.id}`).toEqual([{ state: "uncertain" }]);

    await db`update app.bookings set dispatched_at = now() where id = ${bookingId}`;
    await db`update app.email_deliveries set completed_at = now() where id = ${email!.id}`;
  });

  it("leaves an expired lease in place", async () => {
    const leased = await oldJob("running", 5, "x");

    try {
      await snapshot();
      expect(await db`select state, lease_owner from app.jobs where id = ${leased}`).toEqual([{ lease_owner: "worker", state: "running" }]);
    } finally {
      await db`delete from app.jobs where kind = 'diagnostics_probe'`;
    }
  });

  it("prints a readable snapshot that never calls an empty category healthy", async () => {
    const run = admin();

    expect(await runAdmin(["diagnostics", "snapshot", "--operator", "dana", "--local"], run.deps)).toBe(0);
    expect(run.out[0]).toBe("Environment: local");
    expect(run.out.some((line) => /^jobs_exhausted: \d+/.test(line))).toBe(true);
    expect(run.out.at(-1)).toMatch(/^Not measured here: /);
  });

  it("refuses --local when DATABASE_URL is not the local stack", async () => {
    const run = admin();
    const code = await runAdmin(["diagnostics", "snapshot", "--operator", "dana", "--local"], {
      ...run.deps,
      env: { DATABASE_URL: "postgresql://postgres.anelszynxtvxoxqvzgqt:pw@aws-0-us-east-2.pooler.supabase.com:6543/postgres" },
    });

    expect(code).toBe(1);
    expect(run.out).toEqual([]);
    expect(run.err.join("\n")).toMatch(/not the local stack/);
  });

  it("denies the diagnostics functions to Data API roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const statement of [
        "select app.operator_diagnostics_snapshot(20)",
        "select app.operator_rejection_snapshot()",
        "select app.record_rejection('stale_action')",
      ]) {
        await expect(
          db.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx.unsafe(statement);
          }),
        ).rejects.toThrow(/permission denied/);
      }
    }
  });
});

describe("rejection observations", () => {
  it("counts recognized command rejections only while collection is enabled", async () => {
    const before = await rejectionTotals();

    const unauthenticated = await runCommand({ authenticate: async () => null, db, env: enabled }, failingCommand(null), {
      input: {},
      resourceId: randomUUID(),
      retryKey: randomUUID(),
    });
    expect(!unauthenticated.ok && unauthenticated.error.category).toBe("unauthenticated");
    await asProbeHost(db, failingCommand("stale_revision"), enabled);
    await asProbeHost(db, failingCommand("request_closed"), enabled);
    await asProbeHost(db, failingCommand("invalid_input"), enabled);
    expect((await asProbeHost(db, failingCommand(null), enabled)).ok).toBe(true);
    await asProbeHost(db, failingCommand("stale_revision"), {});

    expect(await rejectionTotals()).toEqual({
      authorization_denied: before.authorization_denied! + 1,
      stale_action: before.stale_action! + 2,
    });
  });

  it("keeps the original rejection when collection fails or hangs", async () => {
    const failing = Object.assign(() => Promise.reject(new Error("storage down")), { begin: db.begin.bind(db) }) as unknown as Database;
    const hanging = Object.assign(() => new Promise(() => {}), { begin: db.begin.bind(db) }) as unknown as Database;
    const reference = await asProbeHost(db, failingCommand("stale_revision"), {});

    for (const database of [failing, hanging]) {
      const started = Date.now();
      const outcome = await asProbeHost(database, failingCommand("stale_revision"), enabled);

      expect(Date.now() - started).toBeLessThan(2_000);
      expect(!outcome.ok && { category: outcome.error.category, message: outcome.error.message }).toEqual(
        !reference.ok && { category: reference.error.category, message: reference.error.message },
      );
    }
  });

  it("increments atomically under concurrency", async () => {
    const before = await rejectionTotals();

    await Promise.all(Array.from({ length: 40 }, () => db`select app.record_rejection('authorization_denied')`));

    expect((await rejectionTotals()).authorization_denied).toBe(before.authorization_denied! + 40);
  });

  it("prunes buckets outside the window on write and never reports them", async () => {
    await db`
      insert into app.rejection_observations (category, bucket, count)
      values ('stale_action', date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00') - interval '30 hours', 7)
    `;
    const before = await rejectionTotals();

    await db`select app.record_rejection('stale_action')`;

    const [old] = await db<{ count: number }[]>`
      select count(*)::int as count from app.rejection_observations where bucket < now() - interval '24 hours'
    `;
    expect(old!.count).toBe(0);
    expect((await rejectionTotals()).stale_action).toBe(before.stale_action! + 1);
  });

  it("saturates a bucket at 10,000 and shows it", async () => {
    await db`select app.record_rejection('stale_action')`;
    await db`
      update app.rejection_observations set count = 9999
      where category = 'stale_action' and bucket = date_bin('1 hour', now(), timestamptz '2000-01-01 00:00:00+00')
    `;

    await db`select app.record_rejection('stale_action')`;
    await db`select app.record_rejection('stale_action')`;

    const run = admin();
    expect(await runAdmin(["diagnostics", "rejections", "--json", "--operator", "dana", "--local"], run.deps)).toBe(0);
    const result = JSON.parse(run.out[0]!) as {
      categories: { name: string; saturated: boolean; buckets: { count: number; saturated: boolean }[] }[];
      currentBucketPartial: boolean;
      notCovered: string[];
    };
    const stale = result.categories.find((category) => category.name === "stale_action")!;

    expect(stale.saturated).toBe(true);
    expect(stale.buckets).toHaveLength(24);
    expect(stale.buckets.at(-1)).toEqual(expect.objectContaining({ count: 10_000, saturated: true }));
    expect(result.currentBucketPartial).toBe(true);
    expect(result.notCovered.length).toBeGreaterThan(0);

    await db`delete from app.rejection_observations where category = 'stale_action'`;
  });
});
