import type { RequestDetails, RequestState } from "../contracts/request";
import { CommandError } from "./commands";
import type { Transaction } from "./database";
import { readReadiness } from "./readiness";

// The per-command closure guard (design decision 4): every requester command
// locks its request and rejects it once the request is closed, its expiry has
// passed or its booking link expired, even when the expiry sweep has not run
// yet, so a late sweep never lets a decision through. The rejection names the
// current status (request_closed); the caller reads the request to show it.
// A draft past its 24 hours is rejected the same way until the sweep deletes it.

export type LockedRequest = {
  readonly id: string;
  readonly host_account_id: string;
  readonly state: RequestState;
  readonly revision: number;
  readonly details: Partial<RequestDetails>;
  // Null only while the request is a draft.
  readonly requester_name: string | null;
  readonly contact_email: string | null;
  readonly contact_confirmed_email: string | null;
  readonly created_at: Date;
  readonly expires_at: Date;
};

export async function lockOpenRequest(tx: Transaction, requestId: string): Promise<LockedRequest> {
  const [row] = await tx<(LockedRequest & { open: boolean })[]>`
    select r.id, r.host_account_id, r.state, r.revision, r.details, r.requester_name, r.contact_email,
           r.contact_confirmed_email, r.created_at, r.expires_at,
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

// Candidate evaluation, selection and agreement need the guest's name and
// email (design decision 2): a draft answers identity_required, which the
// assistant and the page meet with the identity card in the thread. The state
// is checked inside each operation (permission layer 3), not by withholding
// tools, since a draft and its identified request share one audience.
export function assertIdentified(request: Pick<LockedRequest, "state">) {
  if (request.state === "draft") throw new CommandError("identity_required");
}

// Whether the host can take requests now, with its account row share-locked so
// a suspension waits for the caller's transaction: an active account whose
// setup is ready. Starting a draft and identifying it both check it.
export async function hostAcceptsRequests(tx: Transaction, hostAccountId: string) {
  const [account] = await tx<{ status: string }[]>`
    select status from app.host_accounts where id = ${hostAccountId} for share
  `;

  if (account?.status !== "active") return false;
  return (await readReadiness(tx, hostAccountId)).ready;
}
