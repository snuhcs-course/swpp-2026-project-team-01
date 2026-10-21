import type { RequestDetails, RequestState } from "../contracts/request";
import { CommandError } from "./commands";
import type { Transaction } from "./database";

// The per-command closure guard (design decision 4): every requester command
// locks its request and rejects it once the request is closed, its expiry has
// passed or its booking link expired, even when the expiry sweep has not run
// yet, so a late sweep never lets a decision through. The rejection names the
// current status (request_closed); the caller reads the request to show it.

export type LockedRequest = {
  readonly id: string;
  readonly host_account_id: string;
  readonly state: RequestState;
  readonly revision: number;
  readonly details: Partial<RequestDetails>;
  readonly contact_email: string;
  readonly contact_confirmed_email: string | null;
  readonly created_at: Date;
  readonly expires_at: Date;
};

export async function lockOpenRequest(tx: Transaction, requestId: string): Promise<LockedRequest> {
  const [row] = await tx<(LockedRequest & { open: boolean })[]>`
    select r.id, r.host_account_id, r.state, r.revision, r.details, r.contact_email, r.contact_confirmed_email,
           r.created_at, r.expires_at,
           (r.closed_at is null and r.expires_at > now() and l.expires_at > now()) as open
    from app.requests r
    join app.booking_links l on l.request_id = r.id
    where r.id = ${requestId}
    for update of r
  `;

  if (!row) throw new CommandError("forbidden");
  if (!row.open) throw new CommandError("request_closed");

  const { open: _open, ...request } = row;
  return request;
}
