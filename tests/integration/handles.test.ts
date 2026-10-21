import { afterAll, describe, expect, it } from "vitest";
import { assignHandle, checkHandle, currentHandle, HandleError, proposeHandle } from "../../lib/server/handles";
import { testDatabase } from "./support/database";
import { newHostAccount, uniqueHandle } from "./support/ready-host";

const db = testDatabase();

afterAll(async () => {
  await db.end();
});

function assign(hostAccountId: string, handle: string) {
  return db.begin((tx) => assignHandle(tx, hostAccountId, handle));
}

async function assignmentsOf(hostAccountId: string) {
  const [row] = await db<{ count: number }[]>`
    select count(*)::int as count from app.handle_assignments where host_account_id = ${hostAccountId}
  `;
  return row!.count;
}

describe("handle assignment", () => {
  it("assigns a lower-cased handle once and treats the current handle as no change", async () => {
    const host = await newHostAccount(db);
    const handle = uniqueHandle();

    expect(await assign(host, handle.toUpperCase())).toEqual({ changed: true, handle });
    expect(await checkHandle(db, host, handle)).toEqual({ availability: "available", handle });
    expect(await assign(host, handle)).toEqual({ changed: false, handle });
    expect(await assignmentsOf(host)).toBe(1);
    expect(await currentHandle(db, host)).toBe(handle);
  });

  it("rejects format problems and reserved names without assigning", async () => {
    const host = await newHostAccount(db);

    expect((await checkHandle(db, host, "a.b")).availability).toBe("format");
    expect((await checkHandle(db, host, "Support")).availability).toBe("reserved");
    await expect(assign(host, "booking")).rejects.toEqual(new HandleError("reserved"));
    expect(await currentHandle(db, host)).toBeNull();
  });

  it("rejects another host's current or released handle without changing either host", async () => {
    const [alice, bob] = [await newHostAccount(db), await newHostAccount(db)];
    const [first, second] = [uniqueHandle(), uniqueHandle()];

    await assign(alice, first);
    await expect(assign(bob, first)).rejects.toEqual(new HandleError("taken"));

    await assign(alice, second);
    expect((await checkHandle(db, bob, first)).availability).toBe("taken");
    await expect(assign(bob, first)).rejects.toMatchObject({ problem: "taken" });
    expect(await currentHandle(db, bob)).toBeNull();
    expect(await currentHandle(db, alice)).toBe(second);
  });

  it("counts taking back one's own released handle as a change and stops at the limit", async () => {
    const host = await newHostAccount(db);
    const [first, second, third] = [uniqueHandle(), uniqueHandle(), uniqueHandle()];

    await assign(host, first); // free
    await assign(host, second); // change 1
    expect(await assign(host, first)).toEqual({ changed: true, handle: first }); // change 2, reclaimed

    expect((await checkHandle(db, host, third)).availability).toBe("change_limit");
    await expect(assign(host, third)).rejects.toEqual(new HandleError("change_limit"));
    expect(await currentHandle(db, host)).toBe(first);
    expect(await assignmentsOf(host)).toBe(3);
  });

  it("lets changes older than the rolling window fall out of the count", async () => {
    const host = await newHostAccount(db);
    const [first, second, third, fourth] = [uniqueHandle(), uniqueHandle(), uniqueHandle(), uniqueHandle()];

    await assign(host, first);
    await assign(host, second);
    await assign(host, third);
    expect((await checkHandle(db, host, fourth)).availability).toBe("change_limit");

    await db`
      update app.handle_assignments set assigned_at = assigned_at - interval '31 days'
      where host_account_id = ${host} and handle = ${second}
    `;

    expect((await checkHandle(db, host, fourth)).availability).toBe("available");
    expect(await assign(host, fourth)).toEqual({ changed: true, handle: fourth });
  });

  it("gives one handle to exactly one of two hosts racing for it", async () => {
    const [alice, bob] = [await newHostAccount(db), await newHostAccount(db)];
    const handle = uniqueHandle();

    const results = await Promise.allSettled([assign(alice, handle), assign(bob, handle)]);
    const owners = await db<{ host_account_id: string }[]>`
      select host_account_id from app.host_handles where handle = ${handle}
    `;

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: new HandleError("taken"),
    });
    expect(owners).toHaveLength(1);
  });
});

describe("proposed handle", () => {
  it("starts from the address and skips reserved and taken names", async () => {
    const host = await newHostAccount(db);
    const other = await newHostAccount(db);
    const base = uniqueHandle("prop");

    expect(await proposeHandle(db, host, "Admin@example.com")).toBe("admin2");
    expect(await proposeHandle(db, host, `${base}@example.com`)).toBe(base);

    await assign(other, base);
    expect(await proposeHandle(db, host, `${base}@example.com`)).toBe(`${base}2`);
  });
});
