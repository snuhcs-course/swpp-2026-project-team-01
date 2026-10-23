import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveCommand } from "../../lib/server/bookings";
import { claimJobs, type JobHandler, processJob } from "../../lib/server/jobs";
import { type AdminDependencies, runAdmin } from "../../lib/server/operator";
import { agreedRequest, asHost, bookingDeps, bookingJobs, bookingOf, runBooking } from "./support/booking";
import { LOCAL_DATABASE_URL, testDatabase } from "./support/database";
import { type FakeGoogle, startFakeGoogle } from "./support/fake-google";
import { revisionOf } from "./support/scheduling";

// Audited operator recovery (operational-recovery; operations-and-release
// design 6) against the local stack and the fake Google Calendar: requeueing an
// exhausted job under a new fence, reconciling a booking whose write is
// uncertain, the refusals, the confirmation and the audit rows.

const db = testDatabase();
let google: FakeGoogle;

beforeAll(async () => {
  google = await startFakeGoogle();
});

afterAll(async () => {
  await google.close();
  await db.end();
});

function admin(options: { interactive?: boolean; answer?: string } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: AdminDependencies = {
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DATABASE_URL },
    interactive: options.interactive ?? false,
    prompt: async () => options.answer ?? "",
    stderr: (line) => err.push(line),
    stdout: (line) => out.push(line),
  };
  return { deps, err, out };
}

const PROBE = "recovery_probe";

async function exhaustedProbe() {
  const [row] = await db<{ id: string }[]>`
    insert into app.jobs (kind, payload, producer_environment, state, attempts, max_attempts, failure_category)
    values (${PROBE}, '{}'::jsonb, 'local', 'exhausted', 5, 5, 'handler_failed')
    returning id
  `;
  return row!.id;
}

async function audits(targetId: string) {
  return db<{ action: string; environment: string; operator: string; previous_state: string; reason: string }[]>`
    select action, environment, operator, previous_state, reason from app.operator_operations where target_id = ${targetId}
    order by created_at
  `;
}

async function approvedBooking() {
  const request = await agreedRequest(db, google);
  const outcome = await asHost(db, request.hostAccountId, request.requestId, approveCommand, { version: 1 }, {
    expectedRevision: await revisionOf(db, request.requestId),
  });
  if (!outcome.ok) throw new Error(`approve failed: ${outcome.error.category}`);
  return { bookingId: outcome.result.bookingId, request };
}

describe("recover job", () => {
  it("requeues an exhausted job that then completes, fencing out the earlier claim", async () => {
    const jobId = await exhaustedProbe();
    const run = admin();

    expect(await runAdmin(["recover", "job", "--job", jobId, "--attempts", "2", "--reason", "provider outage over", "--operator", "dana", "--local", "--yes"], run.deps)).toBe(0);
    expect(run.out).toEqual([
      "Environment: local",
      `Action: requeue job ${jobId}`,
      `Job ${jobId} (${PROBE}): exhausted:handler_failed -> pending, up to 7 attempts`,
    ]);
    expect(await db`select state, max_attempts, failure_category from app.jobs where id = ${jobId}`).toEqual([
      { failure_category: null, max_attempts: 7, state: "pending" },
    ]);
    expect(await audits(jobId)).toEqual([
      { action: "requeue_job", environment: "local", operator: "dana", previous_state: "exhausted:handler_failed", reason: "provider outage over" },
    ]);

    const ran: string[] = [];
    const handler: JobHandler = async (_tx, job) => void ran.push(job.id);
    const [claimed] = await claimJobs(db, { environment: "local", kinds: [PROBE], owner: "worker" });
    expect(claimed!.id).toBe(jobId);
    expect(await processJob(db, { ...claimed!, fence: claimed!.fence - 1 }, handler)).toBe("fenced");
    expect(await processJob(db, claimed!, handler)).toBe("completed");
    expect(ran).toEqual([jobId]);
  });

  it("refuses a job that is not exhausted, and an unknown job, changing nothing", async () => {
    const jobId = await exhaustedProbe();
    expect(await runAdmin(["recover", "job", "--job", jobId, "--reason", "x", "--operator", "dana", "--local", "--yes"], admin().deps)).toBe(0);

    const again = admin();
    expect(await runAdmin(["recover", "job", "--job", jobId, "--reason", "x", "--operator", "dana", "--local", "--yes"], again.deps)).toBe(1);
    expect(again.err.join("\n")).toMatch(/not exhausted/);

    const unknown = admin();
    expect(await runAdmin(["recover", "job", "--job", randomUUID(), "--reason", "x", "--operator", "dana", "--local", "--yes"], unknown.deps)).toBe(1);
    expect(unknown.err.join("\n")).toMatch(/no job matches/);
    expect(await audits(jobId)).toHaveLength(1);
    await db`delete from app.jobs where kind = ${PROBE}`;
  });

  it("needs --yes or the typed ID, and writes no audit row otherwise", async () => {
    const jobId = await exhaustedProbe();

    const unattended = admin();
    expect(await runAdmin(["recover", "job", "--job", jobId, "--reason", "x", "--operator", "dana", "--local"], unattended.deps)).toBe(1);
    expect(unattended.err.join("\n")).toMatch(/without --yes/);

    const mistyped = admin({ answer: "wrong", interactive: true });
    expect(await runAdmin(["recover", "job", "--job", jobId, "--reason", "x", "--operator", "dana", "--local"], mistyped.deps)).toBe(1);
    expect(await db`select state from app.jobs where id = ${jobId}`).toEqual([{ state: "exhausted" }]);
    expect(await audits(jobId)).toEqual([]);

    const typed = admin({ answer: jobId.toUpperCase(), interactive: true });
    expect(await runAdmin(["recover", "job", "--job", jobId, "--reason", "x", "--operator", "dana", "--local"], typed.deps)).toBe(0);
    await db`delete from app.jobs where kind = ${PROBE}`;
  });
});

describe("recover booking", () => {
  it("reconciles a booking whose write is uncertain into the existing event, never a second one", async () => {
    const { bookingId, request } = await approvedBooking();
    request.setCalendar({ insertBehavior: { [request.calendarId]: "lost_after_create" } });
    const [job] = await bookingJobs(db, bookingId);
    await db`update app.jobs set max_attempts = 1 where id = ${job!.id}`;

    expect(await runBooking(db, bookingDeps(db, google), bookingId)).toBe("exhausted");
    expect((await bookingOf(db, bookingId)).state).toBe("dispatching");

    const run = admin();
    expect(await runAdmin(["recover", "booking", "--booking", bookingId, "--reason", "nobody checked", "--operator", "dana", "--local", "--yes"], run.deps)).toBe(0);
    expect(run.out.at(-1)).toMatch(new RegExp(`^Booking ${bookingId}: dispatching; reconciliation job [0-9a-f-]{36} published$`));
    expect((await bookingOf(db, bookingId)).state).toBe("dispatching");

    const jobs = await bookingJobs(db, bookingId);
    expect(jobs.map((entry) => entry.state)).toEqual(["exhausted", "pending"]);
    const [published] = await db<{ max_attempts: number; producer_environment: string }[]>`
      select producer_environment, max_attempts from app.jobs where id = ${jobs[1]!.id}
    `;
    expect(published).toEqual({ max_attempts: 8, producer_environment: "local" });

    request.setCalendar({});
    await runBooking(db, bookingDeps(db, google), bookingId);
    const booking = await bookingOf(db, bookingId);
    expect(booking.state).toBe("confirmed");
    expect(google.createdEvents(request.calendarId).filter((event) => event.id === booking.event_id)).toHaveLength(1);
    expect(await audits(bookingId)).toEqual([
      { action: "reconcile_booking", environment: "local", operator: "dana", previous_state: "dispatching", reason: "nobody checked" },
    ]);
  });

  it("refuses while a booking job is live, and for a booking that is not dispatching", async () => {
    const { bookingId } = await approvedBooking();

    const reserved = admin();
    expect(await runAdmin(["recover", "booking", "--booking", bookingId, "--reason", "x", "--operator", "dana", "--local", "--yes"], reserved.deps)).toBe(1);
    expect(reserved.err.join("\n")).toMatch(/not waiting on an uncertain write/);

    await db`update app.bookings set state = 'dispatching', dispatched_at = now(), payload = '{}'::jsonb where id = ${bookingId}`;
    const live = admin();
    expect(await runAdmin(["recover", "booking", "--booking", bookingId, "--reason", "x", "--operator", "dana", "--local", "--yes"], live.deps)).toBe(1);
    expect(live.err.join("\n")).toMatch(/already pending or running/);
    expect(await bookingJobs(db, bookingId)).toHaveLength(1);
    expect(await audits(bookingId)).toEqual([]);
  });

  it("denies the recovery functions to Data API roles", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const statement of [
        `select * from app.operator_requeue_job('${randomUUID()}', 1, 'mallory', 'x', 'local')`,
        `select * from app.operator_reconcile_booking('${randomUUID()}', 'local', 'mallory', 'x', 'local')`,
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
