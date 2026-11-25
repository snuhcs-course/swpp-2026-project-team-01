import type { RequestDetails } from "../contracts/request";
import type { Queryable } from "./database";

// Requester-owned command results expire after 30 days; an open change lasts
// at most seven. Keeping the snapshot there also uses requester data deletion.
export type ChangeBaseline = {
  readonly state: "awaiting_host_approval" | "booked";
  readonly proposalId: string;
  readonly details: Partial<RequestDetails>;
  readonly expiresAt: string;
};

const SCHEDULING_FIELDS = new Set([
  "purpose", "durationMinutes", "mode", "location", "linkPlan", "windows",
  "preferredWindows", "lessPreferredWindows", "preferredWeeklyWindows", "travelMode", "timezone",
]);

export function restoreSchedulingDetails(current: Partial<RequestDetails>, previous: Partial<RequestDetails>): Partial<RequestDetails> {
  return {
    ...Object.fromEntries(Object.entries(current).filter(([key]) => !SCHEDULING_FIELDS.has(key))),
    ...Object.fromEntries(Object.entries(previous).filter(([key]) => SCHEDULING_FIELDS.has(key))),
  };
}

export async function captureChangeBaseline(db: Queryable, requestId: string, state: ChangeBaseline["state"]): Promise<ChangeBaseline | null> {
  const [row] = await db<{ details: Partial<RequestDetails>; expires_at: Date; proposal_id: string }[]>`
    select r.details, r.expires_at,
           case when ${state} = 'booked' then
             (select b.proposal_id from app.bookings b where b.request_id = r.id and b.state = 'confirmed')
           else
             (select p.id from app.proposals p join app.agreements a on a.proposal_id = p.id
              where p.request_id = r.id order by a.agreed_at desc limit 1)
           end as proposal_id
    from app.requests r where r.id = ${requestId}
  `;
  return row?.proposal_id ? { details: row.details, expiresAt: row.expires_at.toISOString(), proposalId: row.proposal_id, state } : null;
}

export async function readChangeBaseline(db: Queryable, requestId: string): Promise<ChangeBaseline | null> {
  const [row] = await db<{ operation: string; result: { revision: number; restore?: ChangeBaseline }; revision: number }[]>`
    with agreed as (
      select max(a.agreed_at) as at from app.proposals p join app.agreements a on a.proposal_id = p.id
      where p.request_id = ${requestId}
    )
    select c.operation, c.result, r.revision
    from app.command_outcomes c join app.requests r on r.id::text = c.resource_id cross join agreed
    where r.id = ${requestId} and r.state in ('gathering', 'negotiating')
      and c.actor = ${`requester_request:${requestId}`}
      and c.operation in ('request.change_agreement', 'booking.change') and c.created_at > agreed.at
      and not exists (
        select 1 from app.shared_change_drafts d where d.request_id = r.id
          and d.state in ('checking', 'shared', 'rejected') and coalesce(d.resolved_at, d.created_at) > agreed.at
      )
      and not exists (
        select 1 from app.command_outcomes h where h.resource_id = r.id::text and h.operation = 'booking.change'
          and h.actor like 'host_account:%' and h.created_at > agreed.at and h.created_at < c.created_at
      )
    order by c.created_at limit 1
  `;
  if (!row) return null;
  if (row.result.restore) return row.result.restore;
  // Legacy openings are reconstructible only before any details revision.
  if (row.result.revision !== row.revision) return null;
  return captureChangeBaseline(db, requestId, row.operation === "booking.change" ? "booked" : "awaiting_host_approval");
}
