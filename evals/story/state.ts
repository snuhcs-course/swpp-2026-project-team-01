import { storyRuntime } from "./runtime";

// What a case's database expectations read: the request and every row that
// names it, the jobs it published, the commands run on it and the host's
// linked conversation. The table scan is by column name, as in the earlier
// sets, so a new table is covered without code changes; jobs, command outcomes
// and the messenger binding name the request in other columns and are read here.

export type Row = Record<string, unknown>;
export type Snapshot = Readonly<Record<string, readonly Row[]>>;

export async function snapshot(requestId: string, hostAccountId: string): Promise<Snapshot> {
  const { db } = storyRuntime();
  const tables = await db<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'app' and column_name = 'request_id' order by table_name
  `;
  const rows: Record<string, Row[]> = {
    requests: await db.unsafe("select * from app.requests where id = $1", [requestId]),
  };
  for (const { table_name: table } of tables) {
    rows[table] = await db.unsafe(`select * from app.${table} where request_id = $1 order by 1`, [requestId]);
  }
  rows.jobs = await db.unsafe(
    "select kind, state, payload from app.jobs where payload::text like '%' || $1 || '%' order by created_at, id",
    [requestId],
  );
  rows.command_outcomes = await db.unsafe("select operation from app.command_outcomes where resource_id = $1 order by 1", [requestId]);
  rows.imessage_bindings = await db.unsafe("select channel, state from app.imessage_bindings where host_account_id = $1", [hostAccountId]);
  rows.host_settings = await db.unsafe("select settings, draft_revision from app.host_settings where host_account_id = $1", [hostAccountId]);
  // The host's other requests and their approvals, for a message that decides
  // several requests at once (issue #382).
  rows.host_requests = await db.unsafe("select id, state from app.requests where host_account_id = $1 order by id", [hostAccountId]);
  rows.host_approvals = await db.unsafe(
    "select a.request_id from app.approvals a join app.requests r on r.id = a.request_id where r.host_account_id = $1 order by 1",
    [hostAccountId],
  );
  return rows;
}

// Tables whose rows differ between two snapshots.
export function changedTables(before: Snapshot, after: Snapshot) {
  const same = (table: string) => JSON.stringify(before[table] ?? []) === JSON.stringify(after[table] ?? []);
  return Object.keys({ ...before, ...after }).filter((table) => !same(table));
}

// Rows in `after` that were not in `before`, by id where the table has one.
export function added(before: Snapshot, after: Snapshot, table: string) {
  const known = new Set((before[table] ?? []).map((row) => JSON.stringify(row.id ?? row)));
  return (after[table] ?? []).filter((row) => !known.has(JSON.stringify(row.id ?? row)));
}

// A typed view of the parts most expectations name.
export function view(rows: Snapshot) {
  const request = (rows.requests?.[0] ?? {}) as { state?: string; details?: Record<string, unknown>; revision?: number };
  const proposals = (rows.proposals ?? []) as { version: number; start_at: Date; state?: string }[];
  return {
    bookings: (rows.bookings ?? []) as { state: string; start_at: Date }[],
    details: request.details ?? {},
    proposals,
    latestProposal: proposals.reduce<(typeof proposals)[number] | null>((latest, row) => (!latest || row.version > latest.version ? row : latest), null),
    reviews: (rows.request_reviews ?? []) as { id: string; intent: string; patch: Record<string, unknown> | null; state: string }[],
    approvals: (rows.approvals ?? []) as Row[],
    // Every request of the host by id with its state, and every approval's request.
    hostRequests: (rows.host_requests ?? []) as { id: string; state: string }[],
    hostApprovals: ((rows.host_approvals ?? []) as { request_id: string }[]).map((row) => row.request_id),
    selected: null,
    settings: ((rows.host_settings ?? [])[0]?.settings ?? null) as Record<string, unknown> | null,
    state: request.state ?? null,
    suggestions: (rows.shared_change_drafts ?? []) as { id: string; state: string; changes: Record<string, unknown> }[],
  };
}

export type StoryView = ReturnType<typeof view>;
