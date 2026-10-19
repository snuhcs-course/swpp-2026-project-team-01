import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CommandError } from "../../lib/server/commands";
import { claimJobs, type ClaimedJob, processJob, publishJob } from "../../lib/server/jobs";
import { testDatabase } from "./support/database";

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

// Each test uses its own job kind, so concurrent test files never claim each
// other's work.
function kind() {
  return `test.${randomUUID()}`;
}

async function publish(jobKind: string, options: { dedupeKey?: string; maxAttempts?: number } = {}) {
  return (await db.begin((tx) => publishJob(tx, { kind: jobKind, payload: { n: 1 }, ...options }, "local"))) as
    | string
    | null;
}

function claim(jobKind: string, owner = "worker-a", leaseSeconds = 60) {
  return claimJobs(db, { environment: "local", kinds: [jobKind], leaseSeconds, owner });
}

async function jobRows(jobKind: string) {
  return db<{ attempts: number; failure_category: string | null; fence: number; state: string }[]>`
    select state, attempts, fence, failure_category from app.jobs where kind = ${jobKind} order by created_at
  `;
}

async function expireLease(id: string) {
  await db`update app.jobs set lease_expires_at = now() - interval '1 second' where id = ${id}`;
}

describe("durable jobs", () => {
  it("publishes nothing when the domain transaction rolls back", async () => {
    const jobKind = kind();

    await expect(
      db.begin(async (tx) => {
        await publishJob(tx, { kind: jobKind }, "local");
        throw new Error("domain change failed");
      }),
    ).rejects.toThrow("domain change failed");

    expect(await jobRows(jobKind)).toEqual([]);
  });

  it("records the producer environment and claims only jobs from the requested one", async () => {
    const jobKind = kind();
    await db.begin((tx) => publishJob(tx, { kind: jobKind }, "preview"));
    await publish(jobKind);

    const claimed = await claim(jobKind);

    expect(claimed).toHaveLength(1);
    const rows = await db<{ producer_environment: string; state: string }[]>`
      select producer_environment, state from app.jobs where kind = ${jobKind} order by producer_environment
    `;
    expect(rows).toEqual([
      { producer_environment: "local", state: "running" },
      { producer_environment: "preview", state: "pending" },
    ]);
  });

  it("never hands one job to two concurrent claims", async () => {
    const jobKind = kind();
    await Promise.all(Array.from({ length: 6 }, () => publish(jobKind)));

    const [a, b] = await Promise.all([claim(jobKind, "worker-a"), claim(jobKind, "worker-b")]);
    const ids = [...a, ...b].map((job) => job.id);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("acknowledges a duplicate delivery of a completed job without repeating its effect", async () => {
    const jobKind = kind();
    await publish(jobKind);
    const [job] = await claim(jobKind);
    const handler = vi.fn(async () => ({ done: true }));

    expect(await processJob(db, job!, handler)).toBe("completed");
    expect(await processJob(db, job!, handler)).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await claim(jobKind)).toEqual([]);
  });

  it("keeps one follow-up when the acknowledgment is lost after the follow-up committed", async () => {
    const jobKind = kind();
    const followUpKind = kind();
    await publish(jobKind);
    const [job] = await claim(jobKind);
    const handler = async (tx: Parameters<Parameters<typeof processJob>[2]>[0], current: ClaimedJob) =>
      publishJob(tx, { dedupeKey: `after:${current.id}`, kind: followUpKind }, "local");

    // The worker commits the outcome and follow-up, then dies before its response
    // reaches the caller, which delivers the same message again.
    expect(await processJob(db, job!, handler)).toBe("completed");
    expect(await processJob(db, job!, handler)).toBe("duplicate");
    // A publisher replaying the same logical follow-up is absorbed as well.
    await db.begin((tx) => handler(tx, job!));

    expect(await jobRows(followUpKind)).toEqual([
      { attempts: 0, failure_category: null, fence: 0, state: "pending" },
    ]);
  });

  it("lets another worker reclaim an expired lease under a higher fence and fences the old owner out", async () => {
    const jobKind = kind();
    await publish(jobKind);
    const [first] = await claim(jobKind, "worker-a");

    // worker-a dies mid-job; its lease runs out.
    expect(await claim(jobKind, "worker-b")).toEqual([]);
    await expireLease(first!.id);
    const [second] = await claim(jobKind, "worker-b");

    expect(second!.id).toBe(first!.id);
    expect(second!.fence).toBeGreaterThan(first!.fence);

    const stale = vi.fn(async () => ({ by: "worker-a" }));
    expect(await processJob(db, first!, stale)).toBe("fenced");
    expect(stale).not.toHaveBeenCalled();
    expect(await processJob(db, second!, async () => ({ by: "worker-b" }))).toBe("completed");

    const [row] = await db<{ outcome: { by: string } }[]>`select outcome from app.jobs where id = ${first!.id}`;
    expect(row!.outcome).toEqual({ by: "worker-b" });
  });

  it("leaves an exhausted job visible with its failure category", async () => {
    const jobKind = kind();
    await publish(jobKind, { maxAttempts: 2 });
    const failing = async () => {
      throw new CommandError("unavailable_configuration");
    };

    const [first] = await claim(jobKind);
    expect(await processJob(db, first!, failing)).toBe("failed");
    await db`update app.jobs set run_after = now() where id = ${first!.id}`;
    const [second] = await claim(jobKind);
    expect(await processJob(db, second!, failing)).toBe("exhausted");

    expect(await claim(jobKind)).toEqual([]);
    expect(await jobRows(jobKind)).toEqual([
      { attempts: 2, failure_category: "unavailable_configuration", fence: 2, state: "exhausted" },
    ]);
  });

  it("exhausts a job whose last lease expired without treating the expiry as a failed effect", async () => {
    const jobKind = kind();
    await publish(jobKind, { maxAttempts: 1 });
    const [job] = await claim(jobKind);

    await expireLease(job!.id);

    expect(await claim(jobKind)).toEqual([]);
    expect(await jobRows(jobKind)).toEqual([
      { attempts: 1, failure_category: "lease_expired", fence: 1, state: "exhausted" },
    ]);
  });

  it("backs off a job with many attempts by at most an hour instead of overflowing", async () => {
    const jobKind = kind();
    const id = (await publish(jobKind, { maxAttempts: 100 }))!;
    await db`update app.jobs set attempts = 40 where id = ${id}`;
    const [job] = await claim(jobKind);

    expect(await processJob(db, job!, async () => {
      throw new Error("still failing");
    })).toBe("failed");
    const [row] = await db<{ state: string; delay: number }[]>`
      select state, extract(epoch from run_after - now())::int as delay from app.jobs where id = ${id}
    `;
    expect(row!.state).toBe("pending");
    expect(row!.delay).toBeGreaterThan(3500);
    expect(row!.delay).toBeLessThanOrEqual(3600);
  });

  it("makes a job without runAfter due at the database's time", async () => {
    const jobKind = kind();
    const published = await db.begin(async (tx) => {
      const [clock] = await tx<{ now: Date }[]>`select now()`;
      // The application clock moves on; the transaction's does not.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const id = await publishJob(tx, { kind: jobKind }, "local");
      return { id, now: clock!.now };
    });
    const [row] = await db<{ run_after: Date }[]>`select run_after from app.jobs where id = ${published.id}`;

    expect(row!.run_after.getTime()).toBe(published.now.getTime());
  });
});
