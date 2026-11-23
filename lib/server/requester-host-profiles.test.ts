import { describe, expect, it } from "vitest";
import { ACCOUNT_REQUESTER_TOOLS } from "./agent-account-requester-tools";
import { REQUESTER_TOOLS } from "./agent-requester-tools";
import type { Transaction } from "./database";
import { hostCalendarsCommand, type HostCalendarsOutcome, hostCalendarsMessage } from "./requester-host-profiles";

// Testing baseline R01 M-2.1 (#334): whether a guest-host's host calendars
// count for one request, decided in words. Only the request's Calendars item
// changes, never the host's settings or calendar roles.
const REQUEST = "00000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;

function fakeTx(options: {
  readonly state?: string;
  readonly profile?: { items: string[]; decided_at: Date | null } | null;
  readonly account?: boolean;
  readonly grant?: boolean;
  readonly calendars?: readonly string[];
}) {
  const writes: string[] = [];
  const tx = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    let rows: Row[] = [];
    if (sql.startsWith("select r.id, r.host_account_id, r.state")) {
      rows = [{ details: {}, host_account_id: "h", id: REQUEST, open: true, revision: 3, state: options.state ?? "gathering" }];
    } else if (sql.startsWith("select p.host_account_id, p.items, p.decided_at")) {
      rows = options.profile === null ? [] : [{ host_account_id: "g", ...(options.profile ?? { decided_at: new Date(), items: ["calendars"] }) }];
    } else if (sql.startsWith("select settings from app.host_settings")) {
      rows = [{ settings: { conflictCalendars: (options.calendars ?? ["Work", "Personal"]).map((summary, id) => ({ id: String(id), summary })) } }];
    } else if (sql.startsWith("select id from app.requester_grants")) {
      rows = options.grant ? [{ id: "grant" }] : [];
    } else if (sql.startsWith("select decided_at = created_at as account")) {
      rows = [{ account: options.account ?? true }];
    } else {
      writes.push(sql);
    }
    return Promise.resolve(rows);
  };
  return { tx: tx as unknown as Transaction, writes };
}

function run(tx: Transaction, use: boolean) {
  return hostCalendarsCommand.run(tx, {
    actor: { id: REQUEST, kind: "requester_request" },
    correlationId: "c",
    expectedRevision: 3,
    input: { use },
    resourceId: REQUEST,
    retryKey: "r",
  } as never) as Promise<HostCalendarsOutcome>;
}

describe("use_host_calendars command", () => {
  it("leaves the host calendars out of this request only", async () => {
    const { tx, writes } = fakeTx({});
    await expect(run(tx, false)).resolves.toEqual({ calendars: ["Work", "Personal"], outcome: "not_used", use: false });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("update app.requester_host_profiles set items");
    // Neither host settings nor calendar roles are written.
    expect(writes.join(" ")).not.toMatch(/host_settings|calendar_roles/);
  });

  it("keeps the Calendar step of a request the account sent, and reopens a web one without a grant", async () => {
    expect((await run(fakeTx({ account: true }).tx, false)).outcome).toBe("not_used");
    const web = fakeTx({ account: false });
    await run(web.tx, false);
    expect(web.writes.some((sql) => sql.includes("calendar_settled_at = null"))).toBe(true);
    const account = fakeTx({ account: true });
    await run(account.tx, false);
    expect(account.writes.some((sql) => sql.includes("calendar_settled_at"))).toBe(false);
  });

  it("uses them again and settles the Calendar step", async () => {
    const { tx, writes } = fakeTx({ profile: { decided_at: new Date(), items: [] } });
    await expect(run(tx, true)).resolves.toMatchObject({ outcome: "used", use: true });
    expect(writes.some((sql) => sql.includes("calendar_settled_at = coalesce"))).toBe(true);
  });

  it("changes nothing when it already holds, after agreement, or without host calendars", async () => {
    const same = fakeTx({});
    await expect(run(same.tx, true)).resolves.toMatchObject({ outcome: "unchanged" });
    expect(same.writes).toEqual([]);
    await expect(run(fakeTx({ state: "awaiting_host_approval" }).tx, false)).resolves.toEqual({ outcome: "not_now", state: "awaiting_host_approval" });
    await expect(run(fakeTx({ calendars: [], profile: { decided_at: new Date(), items: [] } }).tx, true)).resolves.toEqual({ outcome: "no_host_calendars" });
    await expect(run(fakeTx({ profile: null }).tx, false)).resolves.toEqual({ outcome: "not_linked" });
  });

  it("refuses an actor other than the request's requester", async () => {
    const { tx } = fakeTx({});
    await expect(
      hostCalendarsCommand.run(tx, { actor: { id: "h", kind: "host_account" }, input: { use: false }, resourceId: REQUEST } as never),
    ).rejects.toMatchObject({ category: "forbidden" });
  });

  it("takes only all or none, never a list of calendars", () => {
    expect(hostCalendarsCommand.input.safeParse({ use: false }).success).toBe(true);
    expect(hostCalendarsCommand.input.safeParse({ calendars: ["Work"], use: true }).success).toBe(false);
  });

  it("says the host settings are unchanged and to find times again", () => {
    const message = hostCalendarsMessage({ calendars: ["Work"], outcome: "not_used", use: false }, "find_times");
    expect(message).toContain("unchanged");
    expect(message).toContain("find_times");
    expect(hostCalendarsMessage({ calendars: ["Work"], outcome: "used", use: true }, "evaluate_candidates")).toContain("Work");
  });
});

describe("use_host_calendars on the account connection", () => {
  it("is a sent-request tool there and not on a per-host connection", () => {
    expect(ACCOUNT_REQUESTER_TOOLS.some((tool) => tool.name === "use_host_calendars")).toBe(true);
    expect(REQUESTER_TOOLS.some((tool) => tool.name === "use_host_calendars")).toBe(false);
  });

  it("keeps a change to the person's own meetings out of the sent request (P-8)", () => {
    const update = ACCOUNT_REQUESTER_TOOLS.find((tool) => tool.name === "update_request_details")!;
    expect(update.description).toContain("update_setup_field");
    expect(update.description).toContain("make my meetings 45 minutes");
  });
});
