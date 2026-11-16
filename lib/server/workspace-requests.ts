import type { RequestDetails, RequestState } from "../contracts/request";
import type { WorkspaceRequestItem } from "../contracts/workspace-request";
import { openBookingLink } from "./booking-links";
import type { Queryable } from "./database";
import { listHostRequests } from "./host-requests";
import type { TokenKey } from "./token-encryption";

type SentRow = {
  id: string;
  state: RequestState;
  details: Partial<RequestDetails>;
  host_name: string | null;
  proposal_start: Date | null;
  booking_start: Date | null;
  updated_at: Date;
  link_ciphertext: string | null;
  link_key_id: string | null;
  link_live: boolean;
};

// The requester account association comes from a verified Google subject or
// signed-in account session, never from a typed contact address. This query
// never reads the receiving host's private
// discussion or settings beyond its public display name.
export async function listWorkspaceRequests(db: Queryable, hostAccountId: string, tokenKeys: readonly TokenKey[]): Promise<WorkspaceRequestItem[]> {
  const [received, sent] = await Promise.all([
    listHostRequests(db, hostAccountId),
    db<SentRow[]>`
      select r.id, r.state, r.details, r.updated_at,
             coalesce(s.settings ->> 'displayName', h.display_name, 'Host') as host_name,
             p.start_at as proposal_start, b.start_at as booking_start,
             l.link_ciphertext, l.link_key_id, coalesce(l.expires_at > now(), false) as link_live
      from app.requester_host_profiles match
      join app.requests r on r.id = match.request_id
      join app.host_accounts h on h.id = r.host_account_id
      left join app.host_settings s on s.host_account_id = r.host_account_id
      left join app.booking_links l on l.request_id = r.id
      left join lateral (
        select start_at from app.proposals where request_id = r.id order by version desc limit 1
      ) p on true
      left join lateral (
        select start_at from app.bookings where request_id = r.id and state = 'confirmed' order by updated_at desc limit 1
      ) b on true
      where match.host_account_id = ${hostAccountId} and r.state <> 'draft'
      order by r.updated_at desc
      limit 100
    `,
  ]);

  const items: WorkspaceRequestItem[] = [
    ...received.map((item) => ({
      bookingPath: null,
      counterpartyName: item.requesterName,
      direction: "received" as const,
      needsDecision: item.needsDecision,
      proposalStart: item.proposalStart,
      purpose: item.purpose,
      requestId: item.requestId,
      state: item.state,
      updatedAt: item.updatedAt,
    })),
    ...sent.map((row) => {
      let bookingPath: string | null = null;
      if (row.link_live && row.link_ciphertext && row.link_key_id) {
        const bookingId = openBookingLink(tokenKeys, {
          link_ciphertext: row.link_ciphertext,
          link_key_id: row.link_key_id,
          request_id: row.id,
        });
        bookingPath = `/booking/${bookingId}`;
      }
      return {
        bookingPath,
        counterpartyName: row.host_name ?? "Host",
        direction: "sent" as const,
        needsDecision: false,
        proposalStart: (row.booking_start ?? row.proposal_start)?.toISOString() ?? null,
        purpose: row.details.purpose ?? null,
        requestId: row.id,
        state: row.state,
        updatedAt: row.updated_at.toISOString(),
      };
    }),
  ];
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
}
